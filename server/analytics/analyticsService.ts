import { getDb } from '../db.js';

export interface AnalyticsSummary {
  queries: {
    total: number;
    successful: number;
    abstained: number;
    failed: number;
    retrievalHitRate: number;
    avgTotalLatencyMs: number;
    avgRetrievalLatencyMs: number;
    avgEmbeddingLatencyMs: number;
    avgLlmLatencyMs: number;
    totalTokens: number;
    confidenceBreakdown: {
      HIGH: number;
      MEDIUM: number;
      LOW: number;
    };
  };
  documents: {
    totalActive: number;
    indexed: number;
    processing: number;
    failed: number;
    totalChunks: number;
  };
  ingestion: {
    totalJobs: number;
    completedJobs: number;
    failedJobs: number;
    avgDurationMs: number;
  };
  feedback: {
    total: number;
    thumbsUp: number;
    thumbsDown: number;
  };
}

export function getAnalyticsSummary(): AnalyticsSummary {
  const db = getDb();

  const qRow = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN failed = 0 AND abstained = 0 THEN 1 ELSE 0 END) AS successful,
      SUM(CASE WHEN abstained = 1 THEN 1 ELSE 0 END) AS abstained,
      SUM(CASE WHEN failed = 1 THEN 1 ELSE 0 END) AS failed,
      SUM(CASE WHEN retrieved_chunks > 0 THEN 1 ELSE 0 END) AS hits,
      COALESCE(AVG(total_latency_ms), 0) AS avg_total,
      COALESCE(AVG(retrieval_latency_ms), 0) AS avg_retrieval,
      COALESCE(AVG(embedding_latency_ms), 0) AS avg_embedding,
      COALESCE(AVG(llm_latency_ms), 0) AS avg_llm,
      COALESCE(SUM(token_usage), 0) AS total_tokens,
      SUM(CASE WHEN confidence = 'HIGH' THEN 1 ELSE 0 END) AS high_conf,
      SUM(CASE WHEN confidence = 'MEDIUM' THEN 1 ELSE 0 END) AS med_conf,
      SUM(CASE WHEN confidence = 'LOW' THEN 1 ELSE 0 END) AS low_conf
    FROM query_metrics
  `).get() as Record<string, number | null>;

  const dRow = db.prepare(`
    SELECT
      COUNT(*) AS total_active,
      SUM(CASE WHEN status = 'INDEXED' THEN 1 ELSE 0 END) AS indexed,
      SUM(CASE WHEN status IN ('UPLOADED', 'PROCESSING') THEN 1 ELSE 0 END) AS processing,
      SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed,
      COALESCE(SUM(chunk_count), 0) AS total_chunks
    FROM documents
    WHERE status != 'DELETED'
  `).get() as Record<string, number | null>;

  const iRow = db.prepare(`
    SELECT
      COUNT(*) AS total_jobs,
      SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed_jobs,
      SUM(CASE WHEN status IN ('FAILED', 'DEAD_LETTER') THEN 1 ELSE 0 END) AS failed_jobs,
      COALESCE(AVG(duration_ms), 0) AS avg_duration
    FROM ingestion_jobs
  `).get() as Record<string, number | null>;

  const fRow = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN rating = 'UP' THEN 1 ELSE 0 END) AS up_count,
      SUM(CASE WHEN rating = 'DOWN' THEN 1 ELSE 0 END) AS down_count
    FROM user_feedback
  `).get() as Record<string, number | null>;

  const totalQueries = Number(qRow.total || 0);
  const hits = Number(qRow.hits || 0);

  return {
    queries: {
      total: totalQueries,
      successful: Number(qRow.successful || 0),
      abstained: Number(qRow.abstained || 0),
      failed: Number(qRow.failed || 0),
      retrievalHitRate: totalQueries > 0 ? Number((hits / totalQueries).toFixed(4)) : 0,
      avgTotalLatencyMs: Math.round(Number(qRow.avg_total || 0)),
      avgRetrievalLatencyMs: Math.round(Number(qRow.avg_retrieval || 0)),
      avgEmbeddingLatencyMs: Math.round(Number(qRow.avg_embedding || 0)),
      avgLlmLatencyMs: Math.round(Number(qRow.avg_llm || 0)),
      totalTokens: Number(qRow.total_tokens || 0),
      confidenceBreakdown: {
        HIGH: Number(qRow.high_conf || 0),
        MEDIUM: Number(qRow.med_conf || 0),
        LOW: Number(qRow.low_conf || 0),
      },
    },
    documents: {
      totalActive: Number(dRow.total_active || 0),
      indexed: Number(dRow.indexed || 0),
      processing: Number(dRow.processing || 0),
      failed: Number(dRow.failed || 0),
      totalChunks: Number(dRow.total_chunks || 0),
    },
    ingestion: {
      totalJobs: Number(iRow.total_jobs || 0),
      completedJobs: Number(iRow.completed_jobs || 0),
      failedJobs: Number(iRow.failed_jobs || 0),
      avgDurationMs: Math.round(Number(iRow.avg_duration || 0)),
    },
    feedback: {
      total: Number(fRow.total || 0),
      thumbsUp: Number(fRow.up_count || 0),
      thumbsDown: Number(fRow.down_count || 0),
    },
  };
}

export function renderPrometheusMetrics(): string {
  const s = getAnalyticsSummary();
  return [
    '# HELP knowledgeassist_queries_total Total RAG queries executed',
    '# TYPE knowledgeassist_queries_total counter',
    `knowledgeassist_queries_total ${s.queries.total}`,
    '# HELP knowledgeassist_queries_abstained_total Queries returning strict abstention',
    '# TYPE knowledgeassist_queries_abstained_total counter',
    `knowledgeassist_queries_abstained_total ${s.queries.abstained}`,
    '# HELP knowledgeassist_queries_failed_total Failed RAG queries',
    '# TYPE knowledgeassist_queries_failed_total counter',
    `knowledgeassist_queries_failed_total ${s.queries.failed}`,
    '# HELP knowledgeassist_query_latency_ms_avg Average total RAG response latency in ms',
    '# TYPE knowledgeassist_query_latency_ms_avg gauge',
    `knowledgeassist_query_latency_ms_avg ${s.queries.avgTotalLatencyMs}`,
    '# HELP knowledgeassist_documents_indexed_total Total indexed documents',
    '# TYPE knowledgeassist_documents_indexed_total gauge',
    `knowledgeassist_documents_indexed_total ${s.documents.indexed}`,
    '# HELP knowledgeassist_chunks_total Total persisted vector chunks',
    '# TYPE knowledgeassist_chunks_total gauge',
    `knowledgeassist_chunks_total ${s.documents.totalChunks}`,
    '# HELP knowledgeassist_feedback_up_total Positive user feedback count',
    '# TYPE knowledgeassist_feedback_up_total counter',
    `knowledgeassist_feedback_up_total ${s.feedback.thumbsUp}`,
  ].join('\n');
}
