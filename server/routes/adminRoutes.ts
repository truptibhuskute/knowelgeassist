import { Router } from 'express';
import { getAnalyticsSummary } from '../analytics/analyticsService.js';
import { getDb } from '../db.js';
import { enqueueIngestionJob } from '../ingestion/ingestionService.js';
import { HttpError } from '../security/authService.js';
import { requireAuth, requireRole } from '../security/middleware.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('ADMIN', 'KNOWLEDGE_OWNER'));

adminRouter.get('/analytics', (_req, res) => {
  res.json(getAnalyticsSummary());
});

adminRouter.get('/ingestion-jobs', (req, res) => {
  const db = getDb();
  const status = req.query.status ? String(req.query.status) : null;
  const rows = status
    ? db.prepare(`
        SELECT j.*, d.name AS document_name, d.file_type
        FROM ingestion_jobs j
        INNER JOIN documents d ON d.id = j.document_id
        WHERE j.status = ?
        ORDER BY j.created_at DESC
        LIMIT 100
      `).all(status)
    : db.prepare(`
        SELECT j.*, d.name AS document_name, d.file_type
        FROM ingestion_jobs j
        INNER JOIN documents d ON d.id = j.document_id
        ORDER BY j.created_at DESC
        LIMIT 100
      `).all();

  res.json({ jobs: rows });
});

adminRouter.post('/ingestion-jobs/:id/retry', async (req, res, next) => {
  try {
    const db = getDb();
    const job = db.prepare('SELECT id, status FROM ingestion_jobs WHERE id = ?').get(
      req.params.id
    ) as { id: string; status: string } | undefined;

    if (!job) {
      throw new HttpError(404, 'JOB_NOT_FOUND', 'Ingestion job not found.');
    }

    db.prepare(`
      UPDATE ingestion_jobs
      SET status = 'PENDING', attempt_count = 0, error_message = NULL, completed_at = NULL
      WHERE id = ?
    `).run(job.id);

    await enqueueIngestionJob(job.id, req.query.sync === 'true');
    res.status(202).json({ id: job.id, status: 'PENDING' });
  } catch (err) {
    next(err);
  }
});

adminRouter.get('/audit-logs', requireRole('ADMIN'), (req, res) => {
  const db = getDb();
  const limit = Math.min(200, Math.max(10, Number(req.query.limit || 50)));
  const rows = db.prepare(`
    SELECT id, actor_user_id, actor_email, action, resource_type, resource_id,
           details_json, correlation_id, ip_address, created_at
    FROM audit_logs
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
  res.json({ logs: rows });
});
