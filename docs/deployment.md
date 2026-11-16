# Deployment Guide

## Option 1: Docker Compose (Spring Boot + PostgreSQL pgvector + Redis + RabbitMQ + Prometheus + Grafana)

1. Copy `.env.example` to `.env` and populate strong secrets (`POSTGRES_PASSWORD`, `RABBITMQ_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OPENAI_API_KEY`, `GRAFANA_ADMIN_PASSWORD`).
2. Start the full stack:
   ```bash
   docker compose up --build -d
   ```
3. Verify service health:
   - Frontend: `http://localhost:3000`
   - Backend Health: `http://localhost:8080/actuator/health`
   - Prometheus: `http://localhost:9090`
   - Grafana: `http://localhost:3001`
   - RabbitMQ Management: `http://localhost:15672`

Flyway runs `V1__init_schema.sql` automatically on Spring Boot startup.

## Option 2: Node.js + Express + React Runtime (Local & Cloud Preview)

1. Install dependencies: `npm install`
2. Optional: Set `GEMINI_API_KEY` in `.env` for live `gemini-4-hydrogen` and `gemini-embedding-2` inference.
3. Run development server: `npm run dev` (listens on port `3000`).
4. Build production bundle: `npm run build` and start with `npm start`.
