package com.knowledgeassist.user;

import com.knowledgeassist.security.AuthenticatedPrincipal;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/users")
public class UserController {

    private final JdbcTemplate jdbcTemplate;

    public UserController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping("/me")
    public Map<String, Object> me(@AuthenticationPrincipal AuthenticatedPrincipal principal) {
        return Map.of(
                "id", principal.userId(),
                "email", principal.email(),
                "roles", principal.roles(),
                "departmentIds", principal.departmentIds()
        );
    }

    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN', 'KNOWLEDGE_OWNER')")
    public Map<String, Object> listUsers() {
        List<Map<String, Object>> users = jdbcTemplate.queryForList(
                "SELECT id, email, full_name, is_active, created_at FROM users ORDER BY created_at DESC");
        return Map.of("users", users);
    }
}
