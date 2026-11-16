package com.knowledgeassist.vector;

import com.knowledgeassist.config.RagProperties;
import com.knowledgeassist.security.AuthenticatedPrincipal;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.Arrays;
import java.util.List;
import java.util.UUID;

@Repository
public class VectorRetrievalRepository {

    public record RetrievedChunk(
            UUID chunkId,
            UUID documentId,
            String documentName,
            int documentVersion,
            int pageNumber,
            String sectionTitle,
            String chunkText,
            double semanticScore,
            double keywordScore,
            double hybridScore
    ) {}

    private final JdbcTemplate jdbcTemplate;
    private final RagProperties ragProperties;

    public VectorRetrievalRepository(JdbcTemplate jdbcTemplate, RagProperties ragProperties) {
        this.jdbcTemplate = jdbcTemplate;
        this.ragProperties = ragProperties;
    }

    /**
     * Enforces document-level authorization inside the PostgreSQL pgvector query BEFORE
     * ranking or returning candidate chunks, preventing any cross-department or restricted leakage.
     */
    public List<RetrievedChunk> findAuthorizedChunks(
            AuthenticatedPrincipal principal,
            String queryText,
            float[] queryEmbedding,
            int topK,
            double similarityThreshold) {
        String vectorLiteral = toPgVectorLiteral(queryEmbedding);

        String sql = """
                SELECT
                    c.id AS chunk_id,
                    c.document_id,
                    d.name AS document_name,
                    c.document_version,
                    c.page_number,
                    c.section_title,
                    c.chunk_text,
                    (1 - (c.embedding <=> CAST(? AS vector))) AS semantic_score,
                    COALESCE(ts_rank(c.text_search_tsv, plainto_tsquery('english', ?)), 0.0) AS keyword_score,
                    ((1 - (c.embedding <=> CAST(? AS vector))) * 0.65 +
                     LEAST(1.0, COALESCE(ts_rank(c.text_search_tsv, plainto_tsquery('english', ?)), 0.0)) * 0.35) AS hybrid_score
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
                  AND (1 - (c.embedding <=> CAST(? AS vector))) >= ?
                ORDER BY hybrid_score DESC
                LIMIT ?
                """;

        return jdbcTemplate.query(sql, (rs, rowNum) -> new RetrievedChunk(
                        UUID.fromString(rs.getString("chunk_id")),
                        UUID.fromString(rs.getString("document_id")),
                        rs.getString("document_name"),
                        rs.getInt("document_version"),
                        rs.getInt("page_number"),
                        rs.getString("section_title"),
                        rs.getString("chunk_text"),
                        rs.getDouble("semantic_score"),
                        rs.getDouble("keyword_score"),
                        rs.getDouble("hybrid_score")
                ),
                vectorLiteral, queryText, vectorLiteral, queryText,
                ragProperties.embeddingModel(),
                principal.userId(), principal.userId(), principal.userId(),
                vectorLiteral, similarityThreshold, topK);
    }

    private String toPgVectorLiteral(float[] vec) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < vec.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(vec[i]);
        }
        sb.append(']');
        return sb.toString();
    }
}
