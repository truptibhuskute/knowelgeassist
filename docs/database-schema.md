# Database Schema & Migrations

The relational schema is defined in `backend/src/main/resources/db/migration/V1__init_schema.sql` for PostgreSQL 16 + `pgvector` (and mirrored in `server/db.ts` for local Node.js execution).

## Core Tables

| Table | Purpose | Key Constraints |
|---|---|---|
| `users` | Employee identities and BCrypt password hashes | `id UUID PK`, `email UNIQUE`, optimistic locking `version` |
| `roles` / `user_roles` | RBAC roles (`EMPLOYEE`, `KNOWLEDGE_OWNER`, `ADMIN`) | Composite PK `(user_id, role_id)` |
| `departments` / `department_members` | Organizational boundaries for `DEPARTMENT` scope | Composite PK `(department_id, user_id)` |
| `documents` | Document metadata, checksums, status, scope | `checksum_sha256` index, `status` check constraint |
| `document_versions` | Immutable upload & replacement history | `UNIQUE (document_id, version_number)` |
| `document_permissions` | Explicit user grants for `RESTRICTED` documents | `UNIQUE (document_id, user_id)` |
| `document_chunks` | Token-aware chunks, `vector(1536)` embeddings, `tsvector` FTS | HNSW cosine index + GIN `tsvector` index |
| `ingestion_jobs` / `ingestion_outbox` | Async job state tracking and transactional outbox | Retry counters, duration metrics |
| `conversations` / `conversation_messages` | Multi-turn user threads, citations JSONB, summaries | Cascading delete on conversation removal |
| `refresh_tokens` | SHA-256 hashed refresh tokens with rotation tracking | `token_hash UNIQUE`, `revoked_at` |
| `audit_logs` | Security & admin action trail with correlation IDs | Indexed by `created_at DESC` |
| `query_metrics` | Latency, token usage, abstention, and confidence records | Used for live admin analytics & Prometheus |
| `user_feedback` | Thumbs up/down ratings per assistant message | `UNIQUE (message_id, user_id)` |
