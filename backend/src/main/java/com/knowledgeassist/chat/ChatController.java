package com.knowledgeassist.chat;

import com.knowledgeassist.rag.RagOrchestrationService;
import com.knowledgeassist.rag.RagOrchestrationService.ChatResponse;
import com.knowledgeassist.security.AuthenticatedPrincipal;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1")
public class ChatController {

    private final RagOrchestrationService ragService;
    private final JdbcTemplate jdbcTemplate;

    public ChatController(RagOrchestrationService ragService, JdbcTemplate jdbcTemplate) {
        this.ragService = ragService;
        this.jdbcTemplate = jdbcTemplate;
    }

    public record ChatRequest(@NotBlank String question, UUID conversationId) {}

    public record FeedbackRequest(UUID messageId, @NotBlank String rating, String comment) {}

    @PostMapping("/chat")
    public ResponseEntity<ChatResponse> chat(
            @AuthenticationPrincipal AuthenticatedPrincipal principal,
            @Valid @RequestBody ChatRequest req) {
        return ResponseEntity.ok(ragService.ask(principal, req.conversationId(), req.question()));
    }

    @GetMapping("/conversations")
    public Map<String, Object> listConversations(@AuthenticationPrincipal AuthenticatedPrincipal principal) {
        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC",
                principal.userId());
        return Map.of("conversations", rows);
    }

    @PostMapping("/feedback")
    public ResponseEntity<Map<String, Object>> submitFeedback(
            @AuthenticationPrincipal AuthenticatedPrincipal principal,
            @Valid @RequestBody FeedbackRequest req) {
        jdbcTemplate.update(
                """
                INSERT INTO user_feedback (id, message_id, user_id, rating, comment)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (message_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment
                """,
                UUID.randomUUID(), req.messageId(), principal.userId(), req.rating(), req.comment());
        return ResponseEntity.status(201).body(Map.of("messageId", req.messageId(), "rating", req.rating()));
    }
}
