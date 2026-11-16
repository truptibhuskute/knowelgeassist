# Security & Access Control Model

## Authentication Controls
- Passwords hashed with BCrypt; plaintext passwords are never stored or logged.
- Short-lived JWT access tokens (`15m`) paired with opaque-tracked rotating refresh tokens (`7d`) stored as SHA-256 digests in `refresh_tokens`.
- Refresh token reuse automatically revokes all active refresh tokens for that user.
- Login brute-force protection locks repeated failed attempts per `(email, IP)` tuple (`429 Too Many Requests`).
- Security principal (`userId`, `roles`, `departmentIds`) is always derived from the verified JWT + active database state (`is_active`), never from request body parameters.

## Document Authorization Model

| Scope | Who Can Retrieve & View |
|---|---|
| `ALL_EMPLOYEES` | Any authenticated active user |
| `DEPARTMENT` | Document owner or verified members of `document.department_id` |
| `RESTRICTED` | Document owner or users with an explicit row in `document_permissions` |

### Database-Level Vector Isolation
Authorization predicates are compiled directly into the SQL retrieval query (`VectorRetrievalRepository` / `VectorRetrievalService`) BEFORE cosine/hybrid scoring and `LIMIT topK`. Unauthorized chunks are never loaded into application memory or passed into the LLM prompt.

## Prompt Injection Defense
- Retrieved document passages are wrapped in `<untrusted_document_context>` delimiters.
- System instructions explicitly forbid executing commands or overriding authorization rules based on document content.
- Every citation emitted by the LLM is cross-checked against the exact authorized `chunkId` set returned by the database; any unverified or fabricated citation causes strict fallback to abstention.
