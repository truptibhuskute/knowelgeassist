package com.knowledgeassist.ingestion;

import com.knowledgeassist.chunking.TokenAwareChunker;
import com.knowledgeassist.chunking.TokenAwareChunker.TextChunk;
import com.knowledgeassist.config.RabbitMqConfig;
import com.knowledgeassist.config.RagProperties;
import com.knowledgeassist.extraction.TextExtractorService;
import com.knowledgeassist.extraction.TextExtractorService.ExtractedPage;
import com.rabbitmq.client.Channel;
import org.springframework.ai.embedding.EmbeddingModel;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.support.AmqpHeaders;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Component
public class IngestionConsumer {

    public record IngestionMessage(UUID jobId, UUID documentId, int documentVersion) {}

    private final JdbcTemplate jdbcTemplate;
    private final TextExtractorService extractor;
    private final TokenAwareChunker chunker;
    private final EmbeddingModel embeddingModel;
    private final RagProperties ragProperties;

    public IngestionConsumer(
            JdbcTemplate jdbcTemplate,
            TextExtractorService extractor,
            TokenAwareChunker chunker,
            EmbeddingModel embeddingModel,
            RagProperties ragProperties) {
        this.jdbcTemplate = jdbcTemplate;
        this.extractor = extractor;
        this.chunker = chunker;
        this.embeddingModel = embeddingModel;
        this.ragProperties = ragProperties;
    }

    @RabbitListener(queues = RabbitMqConfig.INGESTION_QUEUE)
    @Transactional
    public void handleIngestion(
            IngestionMessage message,
            Channel channel,
            @Header(AmqpHeaders.DELIVERY_TAG) long deliveryTag) throws Exception {
        long start = System.currentTimeMillis();
        try {
            Map<String, Object> doc = jdbcTemplate.queryForMap(
                    "SELECT file_type, storage_path, department_id, access_scope, status FROM documents WHERE id = ?",
                    message.documentId());
            if ("DELETED".equals(doc.get("status"))) {
                channel.basicAck(deliveryTag, false);
                return;
            }

            jdbcTemplate.update("UPDATE documents SET status = 'PROCESSING', updated_at = NOW() WHERE id = ?",
                    message.documentId());
            jdbcTemplate.update("UPDATE ingestion_jobs SET status = 'PROCESSING', started_at = NOW(), attempt_count = attempt_count + 1 WHERE id = ?",
                    message.jobId());

            byte[] content = Files.readAllBytes(Path.of(String.valueOf(doc.get("storage_path"))));
            List<ExtractedPage> pages = extractor.extractPages(content, String.valueOf(doc.get("file_type")));
            List<TextChunk> chunks = chunker.chunk(pages);

            List<float[]> vectors = embeddingModel.embed(chunks.stream().map(TextChunk::text).toList());
            jdbcTemplate.update("DELETE FROM document_chunks WHERE document_id = ?", message.documentId());

            for (int i = 0; i < chunks.size(); i++) {
                TextChunk c = chunks.get(i);
                float[] emb = vectors.get(i);
                jdbcTemplate.update(
                        """
                        INSERT INTO document_chunks (
                            id, document_id, document_version, chunk_index, page_number,
                            section_title, chunk_text, token_count, embedding,
                            embedding_model, embedding_dimensions, department_id, access_scope
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS vector), ?, ?, ?, ?)
                        """,
                        UUID.randomUUID(), message.documentId(), message.documentVersion(),
                        c.chunkIndex(), c.pageNumber(), c.sectionTitle(), c.text(), c.tokenCount(),
                        toVectorLiteral(emb), ragProperties.embeddingModel(), emb.length,
                        doc.get("department_id"), String.valueOf(doc.get("access_scope"))
                );
            }

            long durationMs = System.currentTimeMillis() - start;
            jdbcTemplate.update(
                    "UPDATE documents SET status = 'INDEXED', chunk_count = ?, processed_at = NOW(), updated_at = NOW() WHERE id = ?",
                    chunks.size(), message.documentId());
            jdbcTemplate.update(
                    "UPDATE ingestion_jobs SET status = 'COMPLETED', duration_ms = ?, completed_at = NOW() WHERE id = ?",
                    durationMs, message.jobId());

            channel.basicAck(deliveryTag, false);
        } catch (Exception ex) {
            jdbcTemplate.update(
                    "UPDATE documents SET status = 'FAILED', processing_error = ?, updated_at = NOW() WHERE id = ?",
                    ex.getMessage(), message.documentId());
            jdbcTemplate.update(
                    "UPDATE ingestion_jobs SET status = 'FAILED', error_message = ?, completed_at = NOW() WHERE id = ?",
                    ex.getMessage(), message.jobId());
            channel.basicNack(deliveryTag, false, false);
        }
    }

    private String toVectorLiteral(float[] vec) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < vec.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(vec[i]);
        }
        sb.append(']');
        return sb.toString();
    }
}
