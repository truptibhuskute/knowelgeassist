import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';

export interface EmbeddingProvider {
  readonly modelName: string;
  readonly dimensions: number;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export function normalizeVector(vec: number[]): number[] {
  let normSq = 0;
  for (let i = 0; i < vec.length; i += 1) {
    normSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(normSq);
  if (norm === 0) return vec.map(() => 0);
  return vec.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
  }
  return dot;
}

function fnv1aHash(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Deterministic local embedding provider using signed feature hashing over
 * word unigrams, bigrams, and character trigrams. Used when GEMINI_API_KEY is
 * absent or in offline integration tests.
 */
export class LocalDeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly modelName = 'local-hash-256-v1';
  readonly dimensions = 256;

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedSingle(text));
  }

  private embedSingle(text: string): number[] {
    const vec = new Array<number>(this.dimensions).fill(0);
    const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const tokens = normalized.split(/\s+/).filter((t) => t.length >= 2);

    for (let i = 0; i < tokens.length; i += 1) {
      const tok = tokens[i];
      this.addFeature(vec, `w:${tok}`, 1.5);
      if (i + 1 < tokens.length) {
        this.addFeature(vec, `bg:${tok}_${tokens[i + 1]}`, 1.2);
      }
      if (tok.length >= 4) {
        for (let j = 0; j <= tok.length - 3; j += 1) {
          this.addFeature(vec, `c3:${tok.slice(j, j + 3)}`, 0.35);
        }
      }
    }

    return normalizeVector(vec);
  }

  private addFeature(vec: number[], feature: string, weight: number): void {
    const h1 = fnv1aHash(feature);
    const idx = h1 % this.dimensions;
    const sign = (h1 & 1) === 0 ? 1 : -1;
    vec[idx] += sign * weight;
  }
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly modelName: string;
  readonly dimensions = 768;
  private ai: GoogleGenAI;

  constructor(apiKey: string, modelName = config.gemini.embeddingModel) {
    this.modelName = modelName;
    this.ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    // Process in modest batches to respect API limits
    for (const text of texts) {
      const resp = await this.ai.models.embedContent({
        model: this.modelName,
        contents: text,
      });
      const values = resp.embeddings?.[0]?.values;
      if (!values || values.length === 0) {
        throw new Error(`Gemini embedding returned empty vector for model ${this.modelName}`);
      }
      results.push(normalizeVector(values));
    }
    return results;
  }
}

let cachedProvider: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (cachedProvider) return cachedProvider;
  if (config.gemini.apiKey) {
    cachedProvider = new GeminiEmbeddingProvider(config.gemini.apiKey);
  } else {
    cachedProvider = new LocalDeterministicEmbeddingProvider();
  }
  return cachedProvider;
}

export function setEmbeddingProviderForTest(provider: EmbeddingProvider | null): void {
  cachedProvider = provider;
}
