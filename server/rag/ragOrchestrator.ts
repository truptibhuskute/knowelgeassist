import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { recordAudit } from '../audit/auditService.js';
import { getEmbeddingProvider } from '../embedding/embeddingProvider.js';
import { ABSTENTION_MESSAGE, getLlmProvider } from '../llm/llmProvider.js';
import { HttpError } from '../security/authService.js';
import type {
  AuthUser,
  ChatResponseDto,
  CitationDto,
  ConfidenceLevel,
  RetrievedChunk,
} from '../types.js';
import { VectorRetrievalService } from '../vector/vectorRetrievalService.js';

const retrievalService = new VectorRetrievalService();

function computeEvidenceConfidence(
  chunks: RetrievedChunk[],
  verifiedCitations: CitationDto[],
  abstained: boolean
): ConfidenceLevel {
  if (abstained || chunks.length === 0 || verifiedCitations.length === 0) {
    return 'LOW';
  }
  const topScore = chunks[0].hybridScore;
  const meanScore =
    chunks.reduce((acc, c) => acc + c.hybridScore, 0) / Math.max(1, chunks.length);

  if (topScore >= 0.52 && (verifiedCitations.length >= 2 || meanScore >= 0.4)) {
    return 'HIGH';
  }
  if (topScore >= 0.3) {
    return 'MEDIUM';
  }
  return 'LOW';
}

function summarizeHistory(messages: Array<{ role: string; content: string }>): string {
  if (messages.length === 0) return '';
  return messages
    .map((m) => `${m.role}: ${m.content.replace(/\s+/g, ' ').slice(0, 140)}`)
    .join(' | ')
    .slice(0, 900);
}

export async function executeRagChat(input: {
  user: AuthUser;
  question: string;
  conversationId?: string;
  departmentId?: string;
  documentId?: string;
  correlationId?: string;
  ipAddress?: string;
}): Promise<ChatResponseDto> {
  const totalStart = Date.now();
  const question = input.question.trim();
  if (!question) {
    throw new HttpError(400, 'EMPTY_QUESTION', 'Question must not be empty.');
  }
  if (question.length > 2000) {
    throw new HttpError(400, 'QUESTION_TOO_LONG', 'Question exceeds 2,000 characters.');
  }

  const db = getDb();
  const now = new Date().toISOString();
  let conversationId = input.conversationId;
  let conversationSummary = '';

  if (conversationId) {
    const conv = db.prepare(`
      SELECT id, user_id, summary FROM conversations WHERE id = ?
    `).get(conversationId) as
      | { id: string; user_id: string; summary: string | null }
      | undefined;

    if (!conv) {
      throw new HttpError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
    }
    if (conv.user_id !== input.user.id) {
      throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this conversation.');
    }
    conversationSummary = conv.summary || '';
  } else {
    conversationId = uuidv4();
    const title = question.length > 64 ? `${question.slice(0, 61)}...` : question;
    db.prepare(`
      INSERT INTO conversations (id, user_id, title, summary, created_at, updated_at)
      VALUES (?, ?, ?, '', ?, ?)
    `).run(conversationId, input.user.id, title, now, now);
  }

  const allHistory = db.prepare(`
    SELECT role, content FROM conversation_messages
    WHERE conversation_id = ?
    ORDER BY created_at ASC
  `).all(conversationId) as Array<{ role: string; content: string }>;

  const maxTurns = config.rag.maxHistoryTurns;
  let recentHistory = allHistory;
  if (allHistory.length > maxTurns) {
    const older = allHistory.slice(0, allHistory.length - maxTurns);
    conversationSummary = summarizeHistory(older);
    recentHistory = allHistory.slice(-maxTurns);
    db.prepare('UPDATE conversations SET summary = ? WHERE id = ?').run(
      conversationSummary,
      conversationId
    );
  }

  const llmProvider = getLlmProvider();
  const embeddingProvider = getEmbeddingProvider();

  // Persist user message immediately
  const userMsgId = uuidv4();
  db.prepare(`
    INSERT INTO conversation_messages (id, conversation_id, role, content, created_at)
    VALUES (?, ?, 'USER', ?, ?)
  `).run(userMsgId, conversationId, question, now);

  let embeddingLatencyMs = 0;
  let retrievalLatencyMs = 0;
  let llmLatencyMs = 0;
  let failed = false;

  try {
    const standaloneQuery = llmProvider.rewriteFollowUpQuery
      ? await llmProvider.rewriteFollowUpQuery(question, recentHistory)
      : question;

    const embStart = Date.now();
    const [queryEmbedding] = await embeddingProvider.embedBatch([standaloneQuery]);
    embeddingLatencyMs = Date.now() - embStart;

    const retStart = Date.now();
    const retrievedChunks = await retrievalService.retrieveAuthorizedChunks(
      input.user,
      standaloneQuery,
      queryEmbedding,
      {
        departmentId: input.departmentId,
        documentId: input.documentId,
      }
    );
    retrievalLatencyMs = Date.now() - retStart;

    let finalAnswer = ABSTENTION_MESSAGE;
    let abstained = true;
    let verifiedCitations: CitationDto[] = [];
    let followUps: string[] = [];
    let tokenUsage = 0;
    let modelUsed = llmProvider.modelName;

    if (retrievedChunks.length > 0) {
      const llmStart = Date.now();
      const rawOutput = await llmProvider.generateGroundedAnswer({
        question,
        conversationSummary,
        recentHistory,
        chunks: retrievedChunks,
      });
      llmLatencyMs = Date.now() - llmStart;
      tokenUsage = rawOutput.tokenUsage;
      modelUsed = rawOutput.modelName;

      // Resolve and validate every citation against the exact authorized chunks retrieved
      const chunkMap = new Map(retrievedChunks.map((c) => [c.chunkId, c]));
      const seenChunkIds = new Set<string>();
      for (const citedId of rawOutput.citedChunkIds) {
        const matched = chunkMap.get(citedId);
        if (matched && !seenChunkIds.has(matched.chunkId)) {
          seenChunkIds.add(matched.chunkId);
          verifiedCitations.push({
            documentId: matched.documentId,
            documentName: matched.documentName,
            documentVersion: matched.documentVersion,
            pageNumber: matched.pageNumber,
            chunkId: matched.chunkId,
            excerpt:
              matched.chunkText.length > 360
                ? `${matched.chunkText.slice(0, 357)}...`
                : matched.chunkText,
          });
        }
      }

      if (rawOutput.abstained || rawOutput.answer.trim() === ABSTENTION_MESSAGE) {
        abstained = true;
        finalAnswer = ABSTENTION_MESSAGE;
        verifiedCitations = [];
        followUps = [];
      } else if (verifiedCitations.length === 0) {
        // LLM failed to cite any real retrieved chunk -> enforce strict grounding abstention
        abstained = true;
        finalAnswer = ABSTENTION_MESSAGE;
        followUps = [];
      } else {
        abstained = false;
        finalAnswer = rawOutput.answer.trim();
        followUps = rawOutput.followUpQuestions;
      }
    }

    const confidence = computeEvidenceConfidence(retrievedChunks, verifiedCitations, abstained);
    const totalLatencyMs = Date.now() - totalStart;
    const assistantMsgId = uuidv4();
    const assistantNow = new Date().toISOString();
    const retrievalMetadata = {
      retrievedChunkCount: retrievedChunks.length,
      model: modelUsed,
      grounded: true,
      abstained,
      totalLatencyMs,
    };

    db.prepare(`
      INSERT INTO conversation_messages (
        id, conversation_id, role, content, confidence, citations_json,
        follow_up_json, retrieval_metadata_json, created_at
      ) VALUES (?, ?, 'ASSISTANT', ?, ?, ?, ?, ?, ?)
    `).run(
      assistantMsgId,
      conversationId,
      finalAnswer,
      confidence,
      JSON.stringify(verifiedCitations),
      JSON.stringify(followUps),
      JSON.stringify(retrievalMetadata),
      assistantNow
    );

    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
      assistantNow,
      conversationId
    );

    db.prepare(`
      INSERT INTO query_metrics (
        id, user_id, conversation_id, abstained, failed, confidence,
        retrieved_chunks, retrieval_latency_ms, embedding_latency_ms,
        llm_latency_ms, total_latency_ms, token_usage, model_name, created_at
      ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      input.user.id,
      conversationId,
      abstained ? 1 : 0,
      confidence,
      retrievedChunks.length,
      retrievalLatencyMs,
      embeddingLatencyMs,
      llmLatencyMs,
      totalLatencyMs,
      tokenUsage,
      modelUsed,
      assistantNow
    );

    recordAudit({
      actorUserId: input.user.id,
      actorEmail: input.user.email,
      action: 'RAG_QUERY_EXECUTED',
      resourceType: 'CONVERSATION',
      resourceId: conversationId,
      details: {
        confidence,
        abstained,
        retrievedChunks: retrievedChunks.length,
        citedCount: verifiedCitations.length,
      },
      correlationId: input.correlationId,
      ipAddress: input.ipAddress,
    });

    return {
      conversationId,
      messageId: assistantMsgId,
      answer: finalAnswer,
      confidence,
      citations: verifiedCitations,
      followUpQuestions: followUps,
      retrievalMetadata,
    };
  } catch (err) {
    failed = true;
    db.prepare(`
      INSERT INTO query_metrics (
        id, user_id, conversation_id, abstained, failed, confidence,
        retrieved_chunks, retrieval_latency_ms, embedding_latency_ms,
        llm_latency_ms, total_latency_ms, token_usage, model_name, created_at
      ) VALUES (?, ?, ?, 0, 1, 'LOW', 0, ?, ?, ?, ?, 0, ?, ?)
    `).run(
      uuidv4(),
      input.user.id,
      conversationId,
      retrievalLatencyMs,
      embeddingLatencyMs,
      llmLatencyMs,
      Date.now() - totalStart,
      llmProvider.modelName,
      new Date().toISOString()
    );
    if (failed) throw err;
    throw err;
  }
}
