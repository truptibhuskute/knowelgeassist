package com.knowledgeassist.security;

import java.util.List;
import java.util.UUID;

public record AuthenticatedPrincipal(
        UUID userId,
        String email,
        List<String> roles,
        List<UUID> departmentIds
) {
    public boolean hasRole(String role) {
        return roles.contains(role);
    }
}
