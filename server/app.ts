import express from 'express';
import { renderPrometheusMetrics } from './analytics/analyticsService.js';
import { getDb } from './db.js';
import { adminRouter } from './routes/adminRoutes.js';
import { authRouter } from './routes/authRoutes.js';
import { chatRouter, conversationRouter, feedbackRouter } from './routes/chatRoutes.js';
import { documentRouter } from './routes/documentRoutes.js';
import { departmentRouter, userRouter } from './routes/userRoutes.js';
import {
  correlationIdMiddleware,
  errorHandler,
  securityHeadersMiddleware,
} from './security/middleware.js';

export function createApp(): express.Express {
  const app = express();

  app.use(securityHeadersMiddleware);
  app.use(correlationIdMiddleware);
  app.use(express.json({ limit: '2mb' }));

  app.get('/actuator/health', (_req, res) => {
    try {
      const db = getDb();
      db.prepare('SELECT 1').get();
      res.json({
        status: 'UP',
        components: {
          database: { status: 'UP' },
          ragPipeline: { status: 'UP' },
        },
        timestamp: new Date().toISOString(),
      });
    } catch {
      res.status(503).json({ status: 'DOWN' });
    }
  });

  app.get('/actuator/prometheus', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(renderPrometheusMetrics());
  });

  app.get('/api/v1/docs/openapi.json', (_req, res) => {
    res.json({
      openapi: '3.0.3',
      info: {
        title: 'KnowledgeAssist Enterprise RAG API',
        version: '1.0.0',
        description: 'Versioned REST API for Enterprise Document RAG, RBAC, Ingestion, and Analytics.',
      },
      paths: {
        '/api/v1/auth/register': { post: { summary: 'Register employee account' } },
        '/api/v1/auth/login': { post: { summary: 'Authenticate and issue JWT access/refresh tokens' } },
        '/api/v1/auth/refresh': { post: { summary: 'Rotate refresh token' } },
        '/api/v1/auth/logout': { post: { summary: 'Revoke active session' } },
        '/api/v1/users/me': { get: { summary: 'Get authenticated principal profile' } },
        '/api/v1/documents/upload': { post: { summary: 'Upload single document for async ingestion' } },
        '/api/v1/documents': { get: { summary: 'List authorized documents' } },
        '/api/v1/chat': { post: { summary: 'Execute grounded RAG query with citations' } },
        '/api/v1/conversations': { get: { summary: 'List user conversations' } },
        '/api/v1/admin/analytics': { get: { summary: 'System query and ingestion analytics' } },
      },
    });
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', userRouter);
  app.use('/api/v1/departments', departmentRouter);
  app.use('/api/v1/documents', documentRouter);
  app.use('/api/v1/chat', chatRouter);
  app.use('/api/v1/conversations', conversationRouter);
  app.use('/api/v1/feedback', feedbackRouter);
  app.use('/api/v1/admin', adminRouter);

  app.use('/api/*', (_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Requested API endpoint does not exist.',
      },
    });
  });

  app.use(errorHandler);
  return app;
}
