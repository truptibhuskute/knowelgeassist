package com.knowledgeassist.document;

import com.knowledgeassist.common.ApiException;
import com.knowledgeassist.config.RabbitMqConfig;
import com.knowledgeassist.extraction.TextExtractorService;
import com.knowledgeassist.ingestion.IngestionConsumer.IngestionMessage;
import com.knowledgeassist.security.AuthenticatedPrincipal;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.*;

@RestController
@RequestMapping("/api/v1/documents")
public class DocumentController {

    private final JdbcTemplate jdbcTemplate;
    private final TextExtractorService extractorService;
    private final RabbitTemplate rabbitTemplate;
    private final Path uploadRoot;

    public DocumentController(
            JdbcTemplate jdbcTemplate,
            TextExtractorService extractorService,
            RabbitTemplate rabbitTemplate,
            @Value("${knowledgeassist.storage.upload-dir:/app/uploads}") String uploadDir) {
        this.jdbcTemplate = jdbcTemplate;
        this.extractorService = extractorService;
        this.rabbitTemplate = rabbitTemplate;
        this.uploadRoot = Path.of(uploadDir);
    }

    @PostMapping("/upload")
    @PreAuthorize("hasAnyRole('ADMIN', 'KNOWLEDGE_OWNER')")
    @Transactional
    public ResponseEntity<Map<String, Object>> upload(
            @AuthenticationPrincipal AuthenticatedPrincipal principal,
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "accessScope", defaultValue = "ALL_EMPLOYEES") String accessScope,
            @RequestParam(value = "departmentId", required = false) UUID departmentId) throws Exception {
        if (file.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "EMPTY_FILE", "Uploaded file is empty.");
        }
        byte[] bytes = file.getBytes();
        String sha256 = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        Integer dupCount = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM documents WHERE checksum_sha256 = ? AND status != 'DELETED'",
                Integer.class, sha256);
        if (dupCount != null && dupCount > 0) {
            throw new ApiException(HttpStatus.CONFLICT, "DUPLICATE_DOCUMENT", "Duplicate document checksum.");
        }

        UUID docId = UUID.randomUUID();
        UUID jobId = UUID.randomUUID();
        String original = Objects.requireNonNullElse(file.getOriginalFilename(), "document.txt")
                .replaceAll("[^a-zA-Z0-9._-]", "_");
        String fileType = original.toLowerCase().endsWith(".pdf") ? "PDF"
                : original.toLowerCase().endsWith(".docx") ? "DOCX"
                : original.toLowerCase().endsWith(".md") ? "MARKDOWN" : "TXT";

        Path targetDir = uploadRoot.resolve(docId.toString());
        Files.createDirectories(targetDir);
        Path targetFile = targetDir.resolve("v1_" + original);
        Files.write(targetFile, bytes);

        jdbcTemplate.update(
                """
                INSERT INTO documents (
                    id, name, original_filename, mime_type, file_type, file_size_bytes,
                    checksum_sha256, owner_id, department_id, access_scope, status, storage_path
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UPLOADED', ?)
                """,
                docId, original, original, extractorService.detectMimeType(bytes, original),
                fileType, bytes.length, sha256, principal.userId(), departmentId, accessScope, targetFile.toString());

        jdbcTemplate.update(
                "INSERT INTO ingestion_jobs (id, document_id, document_version, status) VALUES (?, ?, 1, 'PENDING')",
                jobId, docId);

        rabbitTemplate.convertAndSend(
                RabbitMqConfig.INGESTION_EXCHANGE,
                RabbitMqConfig.INGESTION_ROUTING_KEY,
                new IngestionMessage(jobId, docId, 1));

        return ResponseEntity.status(HttpStatus.ACCEPTED).body(Map.of(
                "documentId", docId,
                "jobId", jobId,
                "status", "UPLOADED"
        ));
    }

    @GetMapping
    public Map<String, Object> listVisible(@AuthenticationPrincipal AuthenticatedPrincipal principal) {
        boolean isAdmin = principal.hasRole("ADMIN");
        List<Map<String, Object>> docs = jdbcTemplate.queryForList(
                """
                SELECT id, name, original_filename, file_type, access_scope, status, current_version, chunk_count, created_at
                FROM documents d
                WHERE d.status != 'DELETED'
                  AND (
                    ? = TRUE OR d.owner_id = ? OR d.access_scope = 'ALL_EMPLOYEES'
                    OR (d.access_scope = 'DEPARTMENT' AND EXISTS (
                      SELECT 1 FROM department_members dm WHERE dm.department_id = d.department_id AND dm.user_id = ?
                    ))
                    OR (d.access_scope = 'RESTRICTED' AND EXISTS (
                      SELECT 1 FROM document_permissions dp WHERE dp.document_id = d.id AND dp.user_id = ?
                    ))
                  )
                ORDER BY d.updated_at DESC
                """,
                isAdmin, principal.userId(), principal.userId(), principal.userId());
        return Map.of("documents", docs);
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAnyRole('ADMIN', 'KNOWLEDGE_OWNER')")
    @Transactional
    public ResponseEntity<Void> delete(
            @PathVariable UUID id,
            @AuthenticationPrincipal AuthenticatedPrincipal principal) {
        jdbcTemplate.update("UPDATE documents SET status = 'DELETING' WHERE id = ?", id);
        jdbcTemplate.update("DELETE FROM document_chunks WHERE document_id = ?", id);
        jdbcTemplate.update("DELETE FROM document_permissions WHERE document_id = ?", id);
        jdbcTemplate.update("UPDATE documents SET status = 'DELETED', chunk_count = 0 WHERE id = ?", id);
        return ResponseEntity.noContent().build();
    }
}
