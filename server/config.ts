import crypto from 'node:crypto';
import path from 'node:path';

const ephemeralDevAccessSecret = crypto.randomBytes(32).toString('hex');
const ephemeralDevRefreshSecret = crypto.randomBytes(32).toString('hex');

export const config = {
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  dbPath: process.env.SQLITE_DB_PATH || path.resolve(process.cwd(), 'data', 'knowledgeassist.db'),
  uploadDir: process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'data', 'uploads'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 50) * 1024 * 1024,

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || ephemeralDevAccessSecret,
    refreshSecret: process.env.JWT_REFRESH_SECRET || ephemeralDevRefreshSecret,
    accessTtlSeconds: Number(process.env.JWT_ACCESS_TTL_SECONDS || 900),
    refreshTtlSeconds: Number(process.env.JWT_REFRESH_TTL_SECONDS || 604800),
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
      ? process.env.GEMINI_API_KEY
      : undefined,
    chatModel: process.env.GEMINI_CHAT_MODEL || 'gemini-4-hydrogen',
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-2',
  },

  rag: {
    chunkSizeTokens: Number(process.env.RAG_CHUNK_SIZE_TOKENS || 850),
    chunkOverlapTokens: Number(process.env.RAG_CHUNK_OVERLAP_TOKENS || 120),
    topK: Number(process.env.RAG_TOP_K || 5),
    similarityThreshold: Number(process.env.RAG_SIMILARITY_THRESHOLD || 0.18),
    maxHistoryTurns: Number(process.env.RAG_MAX_HISTORY_TURNS || 6),
  },

  security: {
    maxLoginAttempts: Number(process.env.MAX_LOGIN_ATTEMPTS || 5),
    loginWindowMs: Number(process.env.LOGIN_WINDOW_MS || 15 * 60 * 1000),
    allowSelfRegistration: process.env.ALLOW_SELF_REGISTRATION !== 'false',
    seedDemoData: process.env.SEED_DEMO_DATA !== 'false',
  },
};
