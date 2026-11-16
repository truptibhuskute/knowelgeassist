package com.knowledgeassist.analytics;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/admin")
@PreAuthorize("hasAnyRole('ADMIN', 'KNOWLEDGE_OWNER')")
public class AdminController {

    private final JdbcTemplate jdbcTemplate;

    public AdminController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping("/analytics")
    public Map<String, Object> analytics() {
        Map<String, Object> queryStats = jdbcTemplate.queryForMap("""
                SELECT COUNT(*) AS total,
                       SUM(CASE WHEN abstained = TRUE THEN 1 ELSE 0 END) AS abstained,
                       SUM(CASE WHEN failed = TRUE THEN 1 ELSE 0 END) AS failed,
                       COALESCE(AVG(total_latency_ms), 0) AS avg_latency_ms
                FROM query_metrics
                """);
        Map<String, Object> docStats = jdbcTemplate.queryForMap("""
                SELECT COUNT(*) AS total_active,
                       SUM(CASE WHEN status = 'INDEXED' THEN 1 ELSE 0 END) AS indexed,
                       COALESCE(SUM(chunk_count), 0) AS total_chunks
                FROM documents WHERE status != 'DELETED'
                """);
        return Map.of("queries", queryStats, "documents", docStats);
    }

    @GetMapping("/ingestion-jobs")
    public Map<String, Object> ingestionJobs() {
        List<Map<String, Object>> jobs = jdbcTemplate.queryForList(
                "SELECT j.*, d.name AS document_name FROM ingestion_jobs j INNER JOIN documents d ON d.id = j.document_id ORDER BY j.created_at DESC LIMIT 100");
        return Map.of("jobs", jobs);
    }

    @GetMapping("/audit-logs")
    @PreAuthorize("hasRole('ADMIN')")
    public Map<String, Object> auditLogs() {
        List<Map<String, Object>> logs = jdbcTemplate.queryForList(
                "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100");
        return Map.of("logs", logs);
    }
}
