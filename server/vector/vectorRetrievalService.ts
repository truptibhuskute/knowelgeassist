import { config } from '../config.js';
import { getDb } from '../db.js';
import { cosineSimilarity, getEmbeddingProvider } from '../embedding/embeddingProvider.js';
import type { AuthUser, RetrievedChunk } from '../types.js';

export interface RetrievalOptions {
  topK?: number;
  similarityThreshold?: number;
  departmentId?: string;
  documentId?: string;
}

export interface Reranker {
  rerank(query: string, candidates: RetrievedChunk[]): Promise<RetrievedChunk[]>;
}

export class LexicalOverlapReranker implements Reranker {
  async rerank(query: string, candidates: RetrievedChunk[]): Promise<RetrievedChunk[]> {
    const queryTerms = extractQueryTerms(query);
    if (queryTerms.length === 0) return candidates;
    return [...candidates].sort((a, b) => {
      const scoreA = a.hybridScore + computeExactPhraseBonus(query, a.chunkText);
      const scoreB = b.hybridScore + computeExactPhraseBonus(query, b.chunkText);
      return scoreB - scoreA;
    });
  }
}

const STOPWORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'of', 'to', 'in',
  'for', 'with', 'as', 'by', 'it', 'this', 'that', 'are', 'was', 'were', 'be',
  'have', 'has', 'had', 'do', 'does', 'did', 'can', 'could', 'should', 'would',
  'what', 'when', 'where', 'who', 'how', 'why', 'if', 'about', 'from', 'into',
  'must', 'shall', 'may', 'might', 'many', 'much', 'within', 'between', 'during',
  'required', 'requires', 'standard', 'company', 'employees', 'employee',
]);

export function extractQueryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function computeKeywordScore(queryTerms: string[], chunkText: string, docName: string): number {
  if (queryTerms.length === 0) return 0;
  const haystack = `${docName} ${chunkText}`.toLowerCase();
  let matched = 0;
  let totalHits = 0;
  for (const term of queryTerms) {
    if (haystack.includes(term)) {
      matched += 1;
      const occurrences = haystack.split(term).length - 1;
      totalHits += Math.min(3, occurrences);
    }
  }
  const coverage = matched / queryTerms.length;
  const tfBoost = Math.min(1, totalHits / (queryTerms.length * 2));
  return coverage * 0.75 + tfBoost * 0.25;
}

function computeExactPhraseBonus(query: string, chunkText: string): number {
  const cleanQuery = query.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  if (cleanQuery.length < 8) return 0;
  return chunkText.toLowerCase().includes(cleanQuery) ? 0.12 : 0;
}

export class VectorRetrievalService {
  private reranker: Reranker;

  constructor(reranker: Reranker = new LexicalOverlapReranker()) {
    this.reranker = reranker;
  }

  /**
   * CRITICAL SECURITY REQUIREMENT:
   * Authorization constraints are enforced INSIDE the SQL query before any candidate
   * chunks are loaded or scored. Restricted or unauthorized department chunks never
   * enter application memory during retrieval.
   */
  async retrieveAuthorizedChunks(
    user: AuthUser,
    query: string,
    queryEmbedding: number[],
    options?: RetrievalOptions
  ): Promise<RetrievedChunk[]> {
    const db = getDb();
    const provider = getEmbeddingProvider();
    const topK = options?.topK ?? config.rag.topK;
    const threshold = options?.similarityThreshold ?? config.rag.similarityThreshold;

    const params: Array<string | number> = [
      provider.modelName,
      user.id, // owner_id
      user.id, // department_members check
      user.id, // document_permissions check
    ];

    let extraFilterSql = '';
    if (options?.departmentId) {
      extraFilterSql += ' AND d.department_id = ?';
      params.push(options.departmentId);
    }
    if (options?.documentId) {
      extraFilterSql += ' AND d.id = ?';
      params.push(options.documentId);
    }

    const rows = db.prepare(`
      SELECT
        c.id AS chunk_id,
        c.document_id,
        d.name AS document_name,
        c.document_version,
        c.page_number,
        c.section_title,
        c.chunk_text,
        c.embedding_json
      FROM document_chunks c
      INNER JOIN documents d ON d.id = c.document_id
      WHERE d.status = 'INDEXED'
        AND c.document_version = d.current_version
        AND c.embedding_model = ?
        AND (
          d.access_scope = 'ALL_EMPLOYEES'
          OR d.owner_id = ?
          OR (
            d.access_scope = 'DEPARTMENT'
            AND d.department_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM department_members dm
              WHERE dm.department_id = d.department_id AND dm.user_id = ?
            )
          )
          OR (
            d.access_scope = 'RESTRICTED'
            AND EXISTS (
              SELECT 1 FROM document_permissions dp
              WHERE dp.document_id = d.id AND dp.user_id = ?
            )
          )
        )
        ${extraFilterSql}
    `).all(...params) as Array<{
      chunk_id: string;
      document_id: string;
      document_name: string;
      document_version: number;
      page_number: number;
      section_title: string | null;
      chunk_text: string;
      embedding_json: string;
    }>;

    const queryTerms = extractQueryTerms(query);
    const scored: RetrievedChunk[] = [];

    for (const row of rows) {
      let embedding: number[];
      try {
        embedding = JSON.parse(row.embedding_json) as number[];
      } catch {
        continue;
      }

      const semanticScore = Math.max(0, cosineSimilarity(queryEmbedding, embedding));
      const keywordScore = computeKeywordScore(queryTerms, row.chunk_text, row.document_name);
      // Hybrid fusion: 55% dense semantic + 45% lexical keyword coverage
      const hybridScore = semanticScore * 0.55 + keywordScore * 0.45;

      if (hybridScore >= threshold || keywordScore >= 0.5) {
        scored.push({
          chunkId: row.chunk_id,
          documentId: row.document_id,
          documentName: row.document_name,
          documentVersion: row.document_version,
          pageNumber: row.page_number,
          sectionTitle: row.section_title,
          chunkText: row.chunk_text,
          semanticScore: Number(semanticScore.toFixed(4)),
          keywordScore: Number(keywordScore.toFixed(4)),
          hybridScore: Number(hybridScore.toFixed(4)),
        });
      }
    }

    scored.sort((a, b) => b.hybridScore - a.hybridScore);
    const topCandidates = scored.slice(0, Math.max(topK * 2, topK));
    const reranked = await this.reranker.rerank(query, topCandidates);
    return reranked.slice(0, topK);
  }
}
