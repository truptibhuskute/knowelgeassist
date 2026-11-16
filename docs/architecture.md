# KnowledgeAssist System Architecture

KnowledgeAssist is designed as a **modular monolith** following strict layered dependency direction:

```
Controller -> Application Service -> Domain / Core Service -> Repository / Infrastructure
```

## Module Boundaries

1. **Authentication & Security (`auth`, `security`)**: BCrypt password hashing, JWT access tokens, rotating SHA-256 hashed refresh tokens with reuse detection, Redis/in-memory login rate limiting, security headers, and correlation IDs.
2. **User & Department Management (`user`, `department`)**: RBAC roles (`EMPLOYEE`, `KNOWLEDGE_OWNER`, `ADMIN`), account activation/deactivation, and department membership enforcement.
3. **Document Management (`document`)**: Single & bulk multipart upload (PDF, DOCX, TXT, Markdown up to 50 MB), SHA-256 deduplication, filename sanitization, version history, and safe transactional deletion.
4. **Asynchronous Ingestion (`ingestion`, `extraction`, `chunking`, `embedding`)**: RabbitMQ + transactional outbox in Spring Boot (and async job queue in the local Node runtime), Apache Tika/PDFBox/Mammoth text extraction, token-aware overlapping chunking (850 tokens / 120 overlap), batch embedding generation, and transactional vector persistence before marking `INDEXED`.
5. **Permission-Aware Vector Retrieval (`vector`)**: Hybrid dense semantic + lexical keyword retrieval with authorization predicates (`ALL_EMPLOYEES`, `DEPARTMENT`, `RESTRICTED`) pushed directly into the database SQL query before ranking or returning candidate chunks.
6. **RAG Orchestration & Strict Grounding (`rag`, `llm`)**: Multi-turn context window management with summarization, follow-up query rewriting, prompt-injection delimiter wrapping (`<untrusted_document_context>`), structured JSON output validation, strict citation verification against retrieved chunk IDs, and deterministic evidence-based confidence scoring (`HIGH`, `MEDIUM`, `LOW`).
7. **Analytics, Audit & Monitoring (`analytics`, `audit`, `monitoring`)**: Immutable audit log table, query latency/token/confidence telemetry, Actuator health checks, Prometheus scraping, and Grafana dashboards.

## Provider Abstractions

External dependencies (LLM chat, embedding generation, file storage, message broker) sit behind explicit interfaces (`LlmProvider`/`ChatClient`, `EmbeddingProvider`/`EmbeddingModel`) so providers can be swapped without modifying domain orchestration logic.
