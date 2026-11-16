package com.knowledgeassist.security;

import io.jsonwebtoken.Claims;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.UUID;

@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtTokenProvider tokenProvider;
    private final JdbcTemplate jdbcTemplate;

    public JwtAuthenticationFilter(JwtTokenProvider tokenProvider, JdbcTemplate jdbcTemplate) {
        this.tokenProvider = tokenProvider;
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            String token = header.substring(7).trim();
            try {
                Claims claims = tokenProvider.parseAccessToken(token);
                if ("access".equals(claims.get("type", String.class))) {
                    UUID userId = UUID.fromString(claims.getSubject());
                    Boolean active = jdbcTemplate.queryForObject(
                            "SELECT is_active FROM users WHERE id = ?", Boolean.class, userId);
                    if (Boolean.TRUE.equals(active)) {
                        List<String> roles = jdbcTemplate.queryForList(
                                "SELECT r.name FROM roles r INNER JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ?",
                                String.class, userId);
                        List<UUID> deptIds = jdbcTemplate.queryForList(
                                "SELECT department_id FROM department_members WHERE user_id = ?",
                                UUID.class, userId);
                        String email = claims.get("email", String.class);

                        AuthenticatedPrincipal principal = new AuthenticatedPrincipal(userId, email, roles, deptIds);
                        List<SimpleGrantedAuthority> authorities = roles.stream()
                                .map(r -> new SimpleGrantedAuthority("ROLE_" + r))
                                .toList();

                        UsernamePasswordAuthenticationToken auth =
                                new UsernamePasswordAuthenticationToken(principal, null, authorities);
                        SecurityContextHolder.getContext().setAuthentication(auth);
                    }
                }
            } catch (Exception ignored) {
                SecurityContextHolder.clearContext();
            }
        }
        filterChain.doFilter(request, response);
    }
}
