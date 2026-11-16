# RAG Pipeline & Evaluation Methodology

## Ingestion Pipeline
1. Multipart validation (extension + MIME check, 50 MB max) and filename sanitization.
2. SHA-256 checksum deduplication against active documents.
3. Metadata creation (`UPLOADED`) and binary storage.
4. Asynchronous worker (RabbitMQ consumer in Spring Boot / async job queue in local Node server) extracts text (Apache Tika/PDFBox in Java; `pdf-parse`, `mammoth`, UTF-8 in Node) preserving page numbers and section titles.
5. Token-aware sliding window chunker (`850` tokens target, `120` tokens overlap) produces non-empty chunks.
6. Batch embedding generation (`gemini-embedding-2` or configured OpenAI-compatible embedding model, with `local-hash-256-v1` offline fallback).
7. Transactional persistence of chunks and vectors before updating document status to `INDEXED`.

## Query Pipeline
1. Authenticate principal and load bounded conversation history (summarizing older turns past `maxHistoryTurns`).
2. Rewrite follow-up queries using recent turn context.
3. Embed standalone query using the same active `embedding_model` (incompatible models are never mixed).
4. Execute permission-filtered hybrid retrieval (cosine similarity + keyword/TSVECTOR score fusion, `Top-K = 5`, configurable similarity threshold, optional reranker).
5. Construct grounded prompt and call configured LLM (`gemini-4-hydrogen` / Spring AI OpenAI-compatible model) requesting structured JSON output.
6. Validate citations against retrieved `chunkId`s and compute measurable confidence (`HIGH`, `MEDIUM`, `LOW`).
7. Return exact abstention string `"I could not find enough information in the available documents."` if evidence is insufficient.

## Limitations of Automated Evaluation
- Keyword-based faithfulness checks verify surface term presence rather than subtle semantic entailment or negation nuance.
- LLM-as-judge evaluations (if enabled) suffer from verbosity bias, self-preference bias when the same model family generates and judges answers, and sensitivity to rubric phrasing. Human expert spot-checking remains essential for high-stakes compliance policies.
