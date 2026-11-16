import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { recordAudit } from '../audit/auditService.js';
import { config } from '../config.js';
import { getDb } from '../db.js';
import {
  createUploadedDocument,
  deleteDocumentSafely,
  getDocumentById,
  listVisibleDocuments,
  replaceDocumentVersion,
  userCanViewDocument,
} from '../ingestion/ingestionService.js';
import { HttpError } from '../security/authService.js';
import { requireAuth, requireRole } from '../security/middleware.js';
import type { AccessScope } from '../types.js';

export const documentRouter = Router();
documentRouter.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxUploadBytes,
    files: 15,
  },
});

function parseAllowedUserIds(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

documentRouter.post(
  '/upload',
  requireRole('ADMIN', 'KNOWLEDGE_OWNER'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) {
        throw new HttpError(400, 'FILE_REQUIRED', 'Multipart field "file" is required.');
      }
      const accessScope = (req.body?.accessScope as AccessScope) || 'ALL_EMPLOYEES';
      if (!['ALL_EMPLOYEES', 'DEPARTMENT', 'RESTRICTED'].includes(accessScope)) {
        throw new HttpError(400, 'INVALID_SCOPE', 'Invalid accessScope.');
      }

      const result = await createUploadedDocument(
        {
          fileBuffer: file.buffer,
          originalFilename: file.originalname,
          mimeType: file.mimetype,
          documentName: req.body?.name ? String(req.body.name) : undefined,
          departmentId: req.body?.departmentId ? String(req.body.departmentId) : null,
          accessScope,
          allowedUserIds: parseAllowedUserIds(req.body?.allowedUserIds),
          owner: req.authUser!,
          correlationId: req.correlationId,
          ipAddress: req.ip,
        },
        { synchronousIngestion: req.query.sync === 'true' }
      );

      res.status(202).json(result);
    } catch (err) {
      next(err);
    }
  }
);

documentRouter.post(
  '/bulk-upload',
  requireRole('ADMIN', 'KNOWLEDGE_OWNER'),
  upload.array('files', 15),
  async (req, res, next) => {
    try {
      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        throw new HttpError(400, 'FILES_REQUIRED', 'At least one file in "files" field is required.');
      }

      const accessScope = (req.body?.accessScope as AccessScope) || 'ALL_EMPLOYEES';
      const departmentId = req.body?.departmentId ? String(req.body.departmentId) : null;
      const allowedUserIds = parseAllowedUserIds(req.body?.allowedUserIds);

      const uploaded: Array<{ documentId: string; name: string; jobId: string }> = [];
      const failures: Array<{ filename: string; error: string }> = [];

      for (const file of files) {
        try {
          const result = await createUploadedDocument({
            fileBuffer: file.buffer,
            originalFilename: file.originalname,
            mimeType: file.mimetype,
            departmentId,
            accessScope,
            allowedUserIds,
            owner: req.authUser!,
            correlationId: req.correlationId,
            ipAddress: req.ip,
          });
          uploaded.push({
            documentId: result.document.id,
            name: result.document.name,
            jobId: result.jobId,
          });
        } catch (err) {
          failures.push({
            filename: file.originalname,
            error: err instanceof Error ? err.message : 'Upload failed',
          });
        }
      }

      res.status(202).json({ uploaded, failures });
    } catch (err) {
      next(err);
    }
  }
);

documentRouter.get('/', (req, res) => {
  const docs = listVisibleDocuments(req.authUser!, {
    search: req.query.search ? String(req.query.search) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    scope: req.query.scope ? String(req.query.scope) : undefined,
    departmentId: req.query.departmentId ? String(req.query.departmentId) : undefined,
  });
  res.json({ documents: docs });
});

documentRouter.get('/:id', (req, res, next) => {
  try {
    const doc = getDocumentById(req.params.id, req.authUser!);
    if (!doc) {
      throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found or access denied.');
    }
    res.json(doc);
  } catch (err) {
    next(err);
  }
});

documentRouter.get('/:id/status', (req, res, next) => {
  try {
    const doc = getDocumentById(req.params.id, req.authUser!);
    if (!doc) {
      throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found or access denied.');
    }
    const db = getDb();
    const latestJob = db.prepare(`
      SELECT id, status, attempt_count, duration_ms, error_message, created_at, completed_at
      FROM ingestion_jobs
      WHERE document_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(doc.id);

    res.json({
      documentId: doc.id,
      status: doc.status,
      currentVersion: doc.currentVersion,
      chunkCount: doc.chunkCount,
      processingError: doc.processingError,
      processedAt: doc.processedAt,
      latestJob: latestJob || null,
    });
  } catch (err) {
    next(err);
  }
});

documentRouter.get('/:id/versions', (req, res, next) => {
  try {
    if (!userCanViewDocument(req.authUser!, req.params.id)) {
      throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found or access denied.');
    }
    const db = getDb();
    const versions = db.prepare(`
      SELECT
        v.id, v.version_number, v.original_filename, v.file_size_bytes,
        v.checksum_sha256, v.change_note, v.created_at, u.full_name AS uploaded_by_name
      FROM document_versions v
      INNER JOIN users u ON u.id = v.uploaded_by
      WHERE v.document_id = ?
      ORDER BY v.version_number DESC
    `).all(req.params.id);

    res.json({ versions });
  } catch (err) {
    next(err);
  }
});

documentRouter.get('/:id/chunks', (req, res, next) => {
  try {
    const doc = getDocumentById(req.params.id, req.authUser!);
    if (!doc) {
      throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found or access denied.');
    }
    const db = getDb();
    const chunks = db.prepare(`
      SELECT id, chunk_index, page_number, section_title, chunk_text, token_count, embedding_model
      FROM document_chunks
      WHERE document_id = ? AND document_version = ?
      ORDER BY chunk_index ASC
    `).all(doc.id, doc.currentVersion);

    res.json({ document: doc, chunks });
  } catch (err) {
    next(err);
  }
});

documentRouter.post(
  '/:id/replace',
  requireRole('ADMIN', 'KNOWLEDGE_OWNER'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) {
        throw new HttpError(400, 'FILE_REQUIRED', 'Multipart field "file" is required.');
      }
      const result = await replaceDocumentVersion({
        documentId: String(req.params.id),
        fileBuffer: file.buffer,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        changeNote: req.body?.changeNote ? String(req.body.changeNote) : undefined,
        actor: req.authUser!,
        correlationId: req.correlationId,
        ipAddress: req.ip,
        synchronousIngestion: req.query.sync === 'true',
      });
      res.status(202).json(result);
    } catch (err) {
      next(err);
    }
  }
);

documentRouter.patch('/:id', requireRole('ADMIN', 'KNOWLEDGE_OWNER'), (req, res, next) => {
  try {
    const db = getDb();
    const doc = db.prepare(`
      SELECT id, owner_id, access_scope, department_id FROM documents WHERE id = ? AND status != 'DELETED'
    `).get(req.params.id) as
      | { id: string; owner_id: string; access_scope: AccessScope; department_id: string | null }
      | undefined;

    if (!doc) {
      throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
    }
    const isAdmin = req.authUser!.roles.includes('ADMIN');
    if (!isAdmin && doc.owner_id !== req.authUser!.id) {
      throw new HttpError(403, 'FORBIDDEN', 'Only admins or the document owner can update metadata.');
    }

    const { name, accessScope, departmentId } = req.body || {};
    const nextScope: AccessScope = accessScope || doc.access_scope;
    const nextDept = departmentId !== undefined ? departmentId : doc.department_id;
    if (nextScope === 'DEPARTMENT' && !nextDept) {
      throw new HttpError(400, 'DEPARTMENT_REQUIRED', 'departmentId is required for DEPARTMENT scope.');
    }

    const now = new Date().toISOString();
    db.exec('BEGIN');
    try {
      if (name && String(name).trim().length > 0) {
        db.prepare('UPDATE documents SET name = ?, updated_at = ? WHERE id = ?').run(
          String(name).trim(),
          now,
          doc.id
        );
      }
      db.prepare(`
        UPDATE documents SET access_scope = ?, department_id = ?, updated_at = ? WHERE id = ?
      `).run(nextScope, nextDept ?? null, now, doc.id);

      db.prepare(`
        UPDATE document_chunks SET access_scope = ?, department_id = ? WHERE document_id = ?
      `).run(nextScope, nextDept ?? null, doc.id);

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    recordAudit({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'DOCUMENT_METADATA_UPDATED',
      resourceType: 'DOCUMENT',
      resourceId: doc.id,
      details: { accessScope: nextScope, departmentId: nextDept },
      correlationId: req.correlationId,
      ipAddress: req.ip,
    });

    res.json(getDocumentById(doc.id, req.authUser!));
  } catch (err) {
    next(err);
  }
});

documentRouter.delete('/:id', requireRole('ADMIN', 'KNOWLEDGE_OWNER'), (req, res, next) => {
  try {
    deleteDocumentSafely(String(req.params.id), req.authUser!, req.correlationId, req.ip);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

documentRouter.get('/:id/permissions', requireRole('ADMIN', 'KNOWLEDGE_OWNER'), (req, res, next) => {
  try {
    const db = getDb();
    const doc = db.prepare(`
      SELECT id, owner_id, access_scope, department_id FROM documents WHERE id = ? AND status != 'DELETED'
    `).get(req.params.id) as
      | { id: string; owner_id: string; access_scope: AccessScope; department_id: string | null }
      | undefined;

    if (!doc) {
      throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
    }
    const isAdmin = req.authUser!.roles.includes('ADMIN');
    if (!isAdmin && doc.owner_id !== req.authUser!.id) {
      throw new HttpError(403, 'FORBIDDEN', 'Access denied.');
    }

    const grants = db.prepare(`
      SELECT dp.id, dp.user_id, u.email, u.full_name, dp.created_at
      FROM document_permissions dp
      INNER JOIN users u ON u.id = dp.user_id
      WHERE dp.document_id = ?
      ORDER BY u.full_name ASC
    `).all(doc.id);

    res.json({
      documentId: doc.id,
      accessScope: doc.access_scope,
      departmentId: doc.department_id,
      grants,
    });
  } catch (err) {
    next(err);
  }
});

documentRouter.put('/:id/permissions', requireRole('ADMIN', 'KNOWLEDGE_OWNER'), (req, res, next) => {
  try {
    const db = getDb();
    const doc = db.prepare(`
      SELECT id, owner_id FROM documents WHERE id = ? AND status != 'DELETED'
    `).get(req.params.id) as { id: string; owner_id: string } | undefined;

    if (!doc) {
      throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
    }
    const isAdmin = req.authUser!.roles.includes('ADMIN');
    if (!isAdmin && doc.owner_id !== req.authUser!.id) {
      throw new HttpError(403, 'FORBIDDEN', 'Only admins or owner can modify permissions.');
    }

    const { accessScope, departmentId, userIds } = req.body || {};
    if (!['ALL_EMPLOYEES', 'DEPARTMENT', 'RESTRICTED'].includes(accessScope)) {
      throw new HttpError(400, 'INVALID_SCOPE', 'Valid accessScope is required.');
    }
    if (accessScope === 'DEPARTMENT' && !departmentId) {
      throw new HttpError(400, 'DEPARTMENT_REQUIRED', 'departmentId is required for DEPARTMENT scope.');
    }

    const now = new Date().toISOString();
    const allowedIds = Array.isArray(userIds) ? userIds.map(String) : [];

    db.exec('BEGIN');
    try {
      db.prepare(`
        UPDATE documents SET access_scope = ?, department_id = ?, updated_at = ? WHERE id = ?
      `).run(accessScope, departmentId ?? null, now, doc.id);

      db.prepare(`
        UPDATE document_chunks SET access_scope = ?, department_id = ? WHERE document_id = ?
      `).run(accessScope, departmentId ?? null, doc.id);

      db.prepare('DELETE FROM document_permissions WHERE document_id = ?').run(doc.id);
      if (accessScope === 'RESTRICTED' && allowedIds.length > 0) {
        const insertPerm = db.prepare(`
          INSERT OR IGNORE INTO document_permissions (id, document_id, user_id, granted_by, created_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        for (const uid of allowedIds) {
          insertPerm.run(uuidv4(), doc.id, uid, req.authUser!.id, now);
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    recordAudit({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'DOCUMENT_PERMISSIONS_UPDATED',
      resourceType: 'DOCUMENT',
      resourceId: doc.id,
      details: { accessScope, departmentId, grantedUserCount: allowedIds.length },
      correlationId: req.correlationId,
      ipAddress: req.ip,
    });

    res.json({ documentId: doc.id, accessScope, departmentId: departmentId ?? null, userIds: allowedIds });
  } catch (err) {
    next(err);
  }
});
