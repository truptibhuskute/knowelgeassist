package com.knowledgeassist.vector;

import com.knowledgeassist.security.AuthenticatedPrincipal;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertTrue;

@SpringBootTest
@Testcontainers
class VectorRetrievalSecurityIntegrationTest {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>(
            DockerImageName.parse("pgvector/pgvector:pg16").asCompatibleSubstituteFor("postgres"))
            .withDatabaseName("knowledgeassist")
            .withUsername("knowledgeassist")
            .withPassword("testpass");

    @Container
    @ServiceConnection
    static RabbitMQContainer rabbitmq = new RabbitMQContainer("rabbitmq:3.13-management-alpine");

    @Autowired
    private VectorRetrievalRepository retrievalRepository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void enforcesRestrictedDocumentIsolationInsidePgvectorQuery() {
        UUID ownerId = UUID.randomUUID();
        UUID unauthorizedUserId = UUID.randomUUID();
        UUID docId = UUID.randomUUID();
        UUID chunkId = UUID.randomUUID();

        jdbcTemplate.update(
                "INSERT INTO users (id, email, full_name, password_hash) VALUES (?, ?, ?, ?)",
                ownerId, "owner@test.local", "Owner", "$2a$12$hash");
        jdbcTemplate.update(
                "INSERT INTO users (id, email, full_name, password_hash) VALUES (?, ?, ?, ?)",
                unauthorizedUserId, "other@test.local", "Other", "$2a$12$hash");
        jdbcTemplate.update(
                """
                INSERT INTO documents (
                    id, name, original_filename, mime_type, file_type, file_size_bytes,
                    checksum_sha256, owner_id, access_scope, status, storage_path
                ) VALUES (?, 'Restricted_M&A', 'ma.pdf', 'application/pdf', 'PDF', 100,
                    repeat('a', 64), ?, 'RESTRICTED', 'INDEXED', '/tmp/ma.pdf')
                """,
                docId, ownerId);

        StringBuilder vec = new StringBuilder("[0.5");
        for (int i = 1; i < 1536; i++) vec.append(",0.0");
        vec.append("]");

        jdbcTemplate.update(
                """
                INSERT INTO document_chunks (
                    id, document_id, document_version, chunk_index, page_number,
                    chunk_text, token_count, embedding, embedding_model, embedding_dimensions, access_scope
                ) VALUES (?, ?, 1, 0, 1, 'Confidential acquisition terms', 10, CAST(? AS vector),
                    'text-embedding-3-small', 1536, 'RESTRICTED')
                """,
                chunkId, docId, vec.toString());

        float[] queryVec = new float[1536];
        queryVec[0] = 0.5f;

        AuthenticatedPrincipal unauthorized = new AuthenticatedPrincipal(
                unauthorizedUserId, "other@test.local", List.of("EMPLOYEE"), List.of());

        var results = retrievalRepository.findAuthorizedChunks(
                unauthorized, "acquisition terms", queryVec, 5, 0.1);
        assertTrue(results.isEmpty(), "Unauthorized user must receive 0 chunks from pgvector query");
    }
}
