# REST API Documentation (`/api/v1`)

OpenAPI JSON descriptor is served at `GET /api/v1/docs/openapi.json` (and Swagger UI in Spring Boot via `springdoc-openapi`).

## Endpoints Overview

### Authentication
- `POST /api/v1/auth/register` — Register a new `EMPLOYEE` account (ignores any client-submitted roles).
- `POST /api/v1/auth/login` — Authenticate with BCrypt and receive JWT access + refresh tokens (rate-limited).
- `POST /api/v1/auth/refresh` — Rotate refresh token; detects and revokes reused tokens.
- `POST /api/v1/auth/logout` — Revoke active refresh tokens.

### Users & Departments
- `GET /api/v1/users/me` — Return authenticated principal profile, roles, and departments.
- `GET /api/v1/users` — List users (`ADMIN` or `KNOWLEDGE_OWNER`).
- `PATCH /api/v1/users/{id}` — Activate/deactivate account, update roles or departments (`ADMIN`).
- `GET /api/v1/departments` / `POST /api/v1/departments` — List or create departments.

### Documents & Permissions
- `POST /api/v1/documents/upload` — Multipart single document upload (`ADMIN` or `KNOWLEDGE_OWNER`).
- `POST /api/v1/documents/bulk-upload` — Multipart multi-file upload.
- `GET /api/v1/documents` — Permission-filtered document listing.
- `GET /api/v1/documents/{id}` / `status` / `versions` / `chunks` — Document details, ingestion status, version history, and indexed source passages.
- `POST /api/v1/documents/{id}/replace` — Replace file and increment version while preserving history.
- `PATCH /api/v1/documents/{id}` — Update metadata, access scope, or department.
- `DELETE /api/v1/documents/{id}` — Transactional deletion of chunks, permissions, and stored binary.
- `GET /api/v1/documents/{id}/permissions` / `PUT /api/v1/documents/{id}/permissions` — Manage `RESTRICTED` grants.

### Chat, Conversations & Feedback
- `POST /api/v1/chat` — Execute permission-aware RAG query returning grounded answer, confidence, citations, and follow-ups.
- `GET /api/v1/conversations` / `POST /api/v1/conversations` — List or create conversations.
- `GET /api/v1/conversations/{id}/messages` / `PATCH /api/v1/conversations/{id}` / `DELETE /api/v1/conversations/{id}` — Manage owner-isolated threads.
- `POST /api/v1/feedback` — Submit `UP` or `DOWN` rating on an assistant response.

### Admin & Observability
- `GET /api/v1/admin/analytics` — Live query, latency, document, and feedback analytics.
- `GET /api/v1/admin/ingestion-jobs` / `POST /api/v1/admin/ingestion-jobs/{id}/retry` — Monitor and retry ingestion jobs.
- `GET /api/v1/admin/audit-logs` — Security audit trail (`ADMIN`).
- `GET /actuator/health` & `GET /actuator/prometheus` — Health check and Prometheus metrics.
