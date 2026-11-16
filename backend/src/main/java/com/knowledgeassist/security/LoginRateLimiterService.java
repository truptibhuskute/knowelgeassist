package com.knowledgeassist.security;

import com.knowledgeassist.common.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.Duration;

@Service
public class LoginRateLimiterService {

    private final StringRedisTemplate redisTemplate;
    private final int maxAttempts;

    public LoginRateLimiterService(
            StringRedisTemplate redisTemplate,
            @Value("${knowledgeassist.security.max-login-attempts:5}") int maxAttempts) {
        this.redisTemplate = redisTemplate;
        this.maxAttempts = maxAttempts;
    }

    public void checkAllowed(String email, String ipAddress) {
        String key = buildKey(email, ipAddress);
        String raw = redisTemplate.opsForValue().get(key);
        if (raw != null && Integer.parseInt(raw) >= maxAttempts) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_ATTEMPTS",
                    "Too many failed login attempts. Try again in 15 minutes.");
        }
    }

    public void recordFailure(String email, String ipAddress) {
        String key = buildKey(email, ipAddress);
        Long count = redisTemplate.opsForValue().increment(key);
        if (count != null && count == 1L) {
            redisTemplate.expire(key, Duration.ofMinutes(15));
        }
    }

    public void clear(String email, String ipAddress) {
        redisTemplate.delete(buildKey(email, ipAddress));
    }

    private String buildKey(String email, String ipAddress) {
        return "ka:login_attempts:" + email.toLowerCase() + ":" + ipAddress;
    }
}
