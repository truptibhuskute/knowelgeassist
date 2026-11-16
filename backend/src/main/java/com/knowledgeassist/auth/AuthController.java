package com.knowledgeassist.auth;

import com.knowledgeassist.common.ApiException;
import com.knowledgeassist.security.AuthenticatedPrincipal;
import com.knowledgeassist.security.JwtTokenProvider;
import com.knowledgeassist.security.LoginRateLimiterService;
import io.jsonwebtoken.Claims;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final JdbcTemplate jdbcTemplate;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;
    private final LoginRateLimiterService rateLimiter;

    public AuthController(
            JdbcTemplate jdbcTemplate,
            PasswordEncoder passwordEncoder,
            JwtTokenProvider jwtTokenProvider,
            LoginRateLimiterService rateLimiter) {
        this.jdbcTemplate = jdbcTemplate;
        this.passwordEncoder = passwordEncoder;
        this.jwtTokenProvider = jwtTokenProvider;
        this.rateLimiter = rateLimiter;
    }

    public record RegisterRequest(
            @Email @NotBlank String email,
            @NotBlank @Size(min = 2, max = 120) String fullName,
            @NotBlank @Size(min = 8, max = 128) String password) {}

    public record LoginRequest(@Email @NotBlank String email, @NotBlank String password) {}

    public record RefreshRequest(@NotBlank String refreshToken) {}

    @PostMapping("/register")
    @Transactional
    public ResponseEntity<Map<String, Object>> register(@Valid @RequestBody RegisterRequest req) {
        String normalizedEmail = req.email().trim().toLowerCase();
        Integer existing = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM users WHERE email = ?", Integer.class, normalizedEmail);
        if (existing != null && existing > 0) {
            throw new ApiException(HttpStatus.CONFLICT, "EMAIL_EXISTS", "Account already exists.");
        }
        validatePasswordStrength(req.password());

        UUID userId = UUID.randomUUID();
        jdbcTemplate.update(
                "INSERT INTO users (id, email, full_name, password_hash, is_active) VALUES (?, ?, ?, ?, TRUE)",
                userId, normalizedEmail, req.fullName().trim(), passwordEncoder.encode(req.password()));

        UUID roleId = jdbcTemplate.queryForObject(
                "SELECT id FROM roles WHERE name = 'EMPLOYEE'", UUID.class);
        jdbcTemplate.update("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", userId, roleId);

        return ResponseEntity.status(HttpStatus.CREATED)
                .body(issueTokens(userId, normalizedEmail, List.of("EMPLOYEE")));
    }

    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> login(
            @Valid @RequestBody LoginRequest req, HttpServletRequest httpReq) {
        String email = req.email().trim().toLowerCase();
        String ip = httpReq.getRemoteAddr();
        rateLimiter.checkAllowed(email, ip);

        List<Map<String, Object>> rows = jdbcTemplate.queryForList(
                "SELECT id, password_hash, is_active FROM users WHERE email = ?", email);
        if (rows.isEmpty()) {
            rateLimiter.recordFailure(email, ip);
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Invalid email or password.");
        }

        Map<String, Object> user = rows.get(0);
        if (!Boolean.TRUE.equals(user.get("is_active"))) {
            throw new ApiException(HttpStatus.FORBIDDEN, "ACCOUNT_INACTIVE", "Account deactivated.");
        }
        if (!passwordEncoder.matches(req.password(), String.valueOf(user.get("password_hash")))) {
            rateLimiter.recordFailure(email, ip);
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Invalid email or password.");
        }

        rateLimiter.clear(email, ip);
        UUID userId = (UUID) user.get("id");
        List<String> roles = jdbcTemplate.queryForList(
                "SELECT r.name FROM roles r INNER JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?",
                String.class, userId);

        return ResponseEntity.ok(issueTokens(userId, email, roles));
    }

    @PostMapping("/refresh")
    @Transactional
    public ResponseEntity<Map<String, Object>> refresh(@Valid @RequestBody RefreshRequest req) {
        Claims claims = jwtTokenProvider.parseRefreshToken(req.refreshToken());
        UUID userId = UUID.fromString(claims.getSubject());
        String tokenHash = sha256(req.refreshToken());

        List<Map<String, Object>> stored = jdbcTemplate.queryForList(
                "SELECT id, revoked_at, expires_at FROM refresh_tokens WHERE token_hash = ?", tokenHash);
        if (stored.isEmpty()) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_REFRESH_TOKEN", "Token not found.");
        }
        Map<String, Object> row = stored.get(0);
        if (row.get("revoked_at") != null) {
            jdbcTemplate.update("UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL", userId);
            throw new ApiException(HttpStatus.UNAUTHORIZED, "TOKEN_REVOKED", "Refresh token reuse detected.");
        }

        String email = jdbcTemplate.queryForObject("SELECT email FROM users WHERE id = ?", String.class, userId);
        List<String> roles = jdbcTemplate.queryForList(
                "SELECT r.name FROM roles r INNER JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?",
                String.class, userId);

        Map<String, Object> nextTokens = issueTokens(userId, email, roles);
        jdbcTemplate.update("UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ?", row.get("id"));
        return ResponseEntity.ok(nextTokens);
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@AuthenticationPrincipal AuthenticatedPrincipal principal) {
        jdbcTemplate.update("UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL",
                principal.userId());
        return ResponseEntity.noContent().build();
    }

    private Map<String, Object> issueTokens(UUID userId, String email, List<String> roles) {
        String accessToken = jwtTokenProvider.createAccessToken(userId, email, roles);
        UUID refreshId = UUID.randomUUID();
        String refreshToken = jwtTokenProvider.createRefreshToken(userId, refreshId);
        jdbcTemplate.update(
                "INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)",
                refreshId, userId, sha256(refreshToken), Instant.now().plus(7, ChronoUnit.DAYS));

        return Map.of(
                "accessToken", accessToken,
                "refreshToken", refreshToken,
                "expiresIn", 900,
                "user", Map.of("id", userId, "email", email, "roles", roles)
        );
    }

    private void validatePasswordStrength(String password) {
        if (!password.matches("^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}$")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "WEAK_PASSWORD",
                    "Password must be >=8 chars with upper, lower, and numeric characters.");
        }
    }

    private String sha256(String raw) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
