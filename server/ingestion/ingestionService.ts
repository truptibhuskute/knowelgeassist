import fs from 'node:fs';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { getDb } from '../db.js';
import { recordAudit } from '../audit/auditService.js';
import { chunkExtractedPages } from '../chunking/tokenChunker.js';
import { getEmbeddingProvider } from '../embedding/embeddingProvider.js';
import {
  computeSha256,
  detectAndValidateFileType,
  extractDocumentText,
  sanitizeFilename,
} from '../extraction/textExtractor.js';
import { HttpError } from '../security/authService.js';
import type { AccessScope, AuthUser } from '../types.js';

export interface UploadDocumentInput {
  fileBuffer: Buffer;
  originalFilename: string;
  mimeType: string;
  documentName?: string;
  departmentId?: string | null;
  accessScope?: AccessScope;
  allowedUserIds?: string[];
  owner: AuthUser;
  correlationId?: string;
  ipAddress?: string;
}

export interface DocumentDto {
  id: string;
  name: string;
  originalFilename: string;
  mimeType: string;
  fileType: string;
  fileSizeBytes: number;
  checksumSha256: string;
  ownerId: string;
  ownerName: string;
  departmentId: string | null;
  departmentName: string | null;
  accessScope: AccessScope;
  status: string;
  currentVersion: number;
  chunkCount: number;
  processingError: string | null;
  createdAt: string;
  processedAt: string | null;
  updatedAt: string;
}

const pendingQueue: string[] = [];
let workerRunning = false;

export function enqueueIngestionJob(jobId: string, synchronousForTest = false): Promise<void> {
  if (synchronousForTest) {
    return processIngestionJob(jobId);
  }
  pendingQueue.push(jobId);
  if (!workerRunning) {
    setImmediate(() => {
      void drainQueue();
    });
  }
  return Promise.resolve();
}

async function drainQueue(): Promise<void> {
  if (workerRunning) return;
  workerRunning = true;
  try {
    while (pendingQueue.length > 0) {
      const nextJobId = pendingQueue.shift();
      if (nextJobId) {
        await processIngestionJob(nextJobId);
      }
    }
  } finally {
    workerRunning = false;
  }
}

export async function processIngestionJob(jobId: string): Promise<void> {
  const db = getDb();
  const job = db.prepare(`
    SELECT id, document_id, document_version, status, attempt_count, max_attempts
    FROM ingestion_jobs WHERE id = ?
  `).get(jobId) as
    | {
        id: string;
        document_id: string;
        document_version: number;
        status: string;
        attempt_count: number;
        max_attempts: number;
      }
    | undefined;

  if (!job || job.status === 'COMPLETED' || job.status === 'DEAD_LETTER') {
    return;
  }

  const doc = db.prepare(`
    SELECT id, file_type, storage_path, department_id, access_scope, current_version, status
    FROM documents WHERE id = ?
  `).get(job.document_id) as
    | {
        id: string;
        file_type: 'PDF' | 'DOCX' | 'TXT' | 'MARKDOWN';
        storage_path: string;
        department_id: string | null;
        access_scope: AccessScope;
        current_version: number;
        status: string;
      }
    | undefined;

  if (!doc || doc.status === 'DELETED' || doc.status === 'DELETING') {
    return;
  }

  const startedAt = Date.now();
  const nextAttempt = job.attempt_count + 1;

  db.prepare(`
    UPDATE ingestion_jobs
    SET status = 'PROCESSING', attempt_count = ?, started_at = ?
    WHERE id = ?
  `).run(nextAttempt, new Date().toISOString(), jobId);

  db.prepare(`
    UPDATE documents SET status = 'PROCESSING', processing_error = NULL, updated_at = ? WHERE id = ?
  `).run(new Date().toISOString(), doc.id);

  try {
    if (!fs.existsSync(doc.storage_path)) {
      throw new Error('Stored document binary could not be located.');
    }
    const fileBuffer = fs.readFileSync(doc.storage_path);
    const extraction = await extractDocumentText(fileBuffer, doc.file_type);
    const chunks = chunkExtractedPages(extraction.pages);
    if (chunks.length === 0) {
      throw new Error('Document produced zero text chunks after extraction.');
    }

    const provider = getEmbeddingProvider();
    const embeddings = await provider.embedBatch(chunks.map((c) => c.text));
    if (embeddings.length !== chunks.length) {
      throw new Error('Embedding count mismatch with extracted chunks.');
    }

    const now = new Date().toISOString();

    // Transactional vector persistence before marking INDEXED
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(doc.id);

      const insertChunk = db.prepare(`
        INSERT INTO document_chunks (
          id, document_id, document_version, chunk_index, page_number,
          section_title, chunk_text, token_count, embedding_json,
          embedding_model, embedding_dimensions, department_id,
          access_scope, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < chunks.length; i += 1) {
        const c = chunks[i];
        const emb = embeddings[i];
        insertChunk.run(
          uuidv4(),
          doc.id,
          job.document_version,
          c.chunkIndex,
          c.pageNumber,
          c.sectionTitle,
          c.text,
          c.tokenCount,
          JSON.stringify(emb),
          provider.modelName,
          emb.length,
          doc.department_id,
          doc.access_scope,
          JSON.stringify({ pageNumber: c.pageNumber, sectionTitle: c.sectionTitle }),
          now
        );
      }

      const durationMs = Date.now() - startedAt;
      db.prepare(`
        UPDATE documents
        SET status = 'INDEXED', chunk_count = ?, processing_error = NULL,
            processed_at = ?, updated_at = ?
        WHERE id = ?
      `).run(chunks.length, now, now, doc.id);

      db.prepare(`
        UPDATE ingestion_jobs
        SET status = 'COMPLETED', duration_ms = ?, error_message = NULL, completed_at = ?
        WHERE id = ?
      `).run(durationMs, now, jobId);

      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown ingestion failure';
    const isDeadLetter = nextAttempt >= job.max_attempts;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE ingestion_jobs
      SET status = ?, error_message = ?, duration_ms = ?, completed_at = ?
      WHERE id = ?
    `).run(isDeadLetter ? 'DEAD_LETTER' : 'FAILED', message, Date.now() - startedAt, now, jobId);

    db.prepare(`
      UPDATE documents
      SET status = 'FAILED', processing_error = ?, updated_at = ?
      WHERE id = ?
    `).run(message, now, doc.id);

    if (!isDeadLetter) {
      // Schedule bounded retry
      setTimeout(() => {
        pendingQueue.push(jobId);
        void drainQueue();
      }, 250 * nextAttempt);
    }
  }
}

export async function createUploadedDocument(
  input: UploadDocumentInput,
  options?: { synchronousIngestion?: boolean }
): Promise<{ document: DocumentDto; jobId: string }> {
  if (!input.fileBuffer || input.fileBuffer.length === 0) {
    throw new HttpError(400, 'EMPTY_FILE', 'Uploaded file is empty.');
  }
  if (input.fileBuffer.length > config.maxUploadBytes) {
    throw new HttpError(413, 'FILE_TOO_LARGE', 'File exceeds maximum allowed 50 MB size.');
  }

  const fileType = detectAndValidateFileType(input.originalFilename, input.mimeType);
  const sanitized = sanitizeFilename(input.originalFilename);
  const checksum = computeSha256(input.fileBuffer);
  const accessScope: AccessScope = input.accessScope || 'ALL_EMPLOYEES';

  if (accessScope === 'DEPARTMENT' && !input.departmentId) {
    throw new HttpError(
      400,
      'DEPARTMENT_REQUIRED',
      'A departmentId is required when accessScope is DEPARTMENT.'
    );
  }

  const db = getDb();
  const dup = db.prepare(`
    SELECT id, name FROM documents WHERE checksum_sha256 = ? AND status != 'DELETED'
  `).get(checksum) as { id: string; name: string } | undefined;

  if (dup) {
    throw new HttpError(
      409,
      'DUPLICATE_DOCUMENT',
      `A document with identical content already exists: "${dup.name}".`
    );
  }

  if (input.departmentId) {
    const dept = db.prepare('SELECT id FROM departments WHERE id = ?').get(input.departmentId);
    if (!dept) {
      throw new HttpError(404, 'DEPARTMENT_NOT_FOUND', 'Target department does not exist.');
    }
  }

  const docId = uuidv4();
  const versionId = uuidv4();
  const jobId = uuidv4();
  const now = new Date().toISOString();
  const docName = (input.documentName || sanitized.replace(/\.[^.]+$/, '')).trim();
  const docDir = path.join(config.uploadDir, docId);
  fs.mkdirSync(docDir, { recursive: true });
  const storagePath = path.join(docDir, `v1_${sanitized}`);
  fs.writeFileSync(storagePath, input.fileBuffer);

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO documents (
        id, name, original_filename, mime_type, file_type, file_size_bytes,
        checksum_sha256, owner_id, department_id, access_scope, status,
        current_version, chunk_count, storage_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'UPLOADED', 1, 0, ?, ?, ?)
    `).run(
      docId,
      docName,
      sanitized,
      input.mimeType || 'application/octet-stream',
      fileType,
      input.fileBuffer.length,
      checksum,
      input.owner.id,
      input.departmentId ?? null,
      accessScope,
      storagePath,
      now,
      now
    );

    db.prepare(`
      INSERT INTO document_versions (
        id, document_id, version_number, original_filename, mime_type,
        file_size_bytes, checksum_sha256, storage_path, uploaded_by, change_note, created_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 'Initial upload', ?)
    `).run(
      versionId,
      docId,
      sanitized,
      input.mimeType || 'application/octet-stream',
      input.fileBuffer.length,
      checksum,
      storagePath,
      input.owner.id,
      now
    );

    if (accessScope === 'RESTRICTED' && input.allowedUserIds?.length) {
      const insertPerm = db.prepare(`
        INSERT OR IGNORE INTO document_permissions (id, document_id, user_id, granted_by, created_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const uid of input.allowedUserIds) {
        insertPerm.run(uuidv4(), docId, uid, input.owner.id, now);
      }
    }

    db.prepare(`
      INSERT INTO ingestion_jobs (
        id, document_id, document_version, status, attempt_count, max_attempts, created_at
      ) VALUES (?, ?, 1, 'PENDING', 0, 3, ?)
    `).run(jobId, docId, now);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    if (fs.existsSync(storagePath)) fs.unlinkSync(storagePath);
    throw err;
  }

  recordAudit({
    actorUserId: input.owner.id,
    actorEmail: input.owner.email,
    action: 'DOCUMENT_UPLOADED',
    resourceType: 'DOCUMENT',
    resourceId: docId,
    details: { name: docName, accessScope, fileType },
    correlationId: input.correlationId,
    ipAddress: input.ipAddress,
  });

  await enqueueIngestionJob(jobId, Boolean(options?.synchronousIngestion));
  return { document: getDocumentById(docId, input.owner)!, jobId };
}

export async function replaceDocumentVersion(input: {
  documentId: string;
  fileBuffer: Buffer;
  originalFilename: string;
  mimeType: string;
  changeNote?: string;
  actor: AuthUser;
  correlationId?: string;
  ipAddress?: string;
  synchronousIngestion?: boolean;
}): Promise<{ document: DocumentDto; jobId: string }> {
  const db = getDb();
  const existing = db.prepare(`
    SELECT id, owner_id, current_version, status FROM documents WHERE id = ? AND status != 'DELETED'
  `).get(input.documentId) as
    | { id: string; owner_id: string; current_version: number; status: string }
    | undefined;

  if (!existing) {
    throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
  }
  const isAdmin = input.actor.roles.includes('ADMIN');
  if (!isAdmin && existing.owner_id !== input.actor.id) {
    throw new HttpError(403, 'FORBIDDEN', 'Only administrators or the document owner can replace versions.');
  }

  const fileType = detectAndValidateFileType(input.originalFilename, input.mimeType);
  const sanitized = sanitizeFilename(input.originalFilename);
  const checksum = computeSha256(input.fileBuffer);
  const nextVersion = existing.current_version + 1;
  const now = new Date().toISOString();
  const jobId = uuidv4();

  const docDir = path.join(config.uploadDir, existing.id);
  fs.mkdirSync(docDir, { recursive: true });
  const storagePath = path.join(docDir, `v${nextVersion}_${sanitized}`);
  fs.writeFileSync(storagePath, input.fileBuffer);

  db.exec('BEGIN');
  try {
    db.prepare(`
      UPDATE documents
      SET original_filename = ?, mime_type = ?, file_type = ?, file_size_bytes = ?,
          checksum_sha256 = ?, status = 'UPLOADED', current_version = ?,
          storage_path = ?, processing_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(
      sanitized,
      input.mimeType || 'application/octet-stream',
      fileType,
      input.fileBuffer.length,
      checksum,
      nextVersion,
      storagePath,
      now,
      existing.id
    );

    db.prepare(`
      INSERT INTO document_versions (
        id, document_id, version_number, original_filename, mime_type,
        file_size_bytes, checksum_sha256, storage_path, uploaded_by, change_note, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      existing.id,
      nextVersion,
      sanitized,
      input.mimeType || 'application/octet-stream',
      input.fileBuffer.length,
      checksum,
      storagePath,
      input.actor.id,
      input.changeNote || `Replaced with version ${nextVersion}`,
      now
    );

    db.prepare(`
      INSERT INTO ingestion_jobs (
        id, document_id, document_version, status, attempt_count, max_attempts, created_at
      ) VALUES (?, ?, ?, 'PENDING', 0, 3, ?)
    `).run(jobId, existing.id, nextVersion, now);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    if (fs.existsSync(storagePath)) fs.unlinkSync(storagePath);
    throw err;
  }

  recordAudit({
    actorUserId: input.actor.id,
    actorEmail: input.actor.email,
    action: 'DOCUMENT_VERSION_REPLACED',
    resourceType: 'DOCUMENT',
    resourceId: existing.id,
    details: { version: nextVersion },
    correlationId: input.correlationId,
    ipAddress: input.ipAddress,
  });

  await enqueueIngestionJob(jobId, Boolean(input.synchronousIngestion));
  return { document: getDocumentById(existing.id, input.actor)!, jobId };
}

export function deleteDocumentSafely(
  documentId: string,
  actor: AuthUser,
  correlationId?: string,
  ipAddress?: string
): void {
  const db = getDb();
  const doc = db.prepare(`
    SELECT id, name, owner_id, storage_path FROM documents WHERE id = ? AND status != 'DELETED'
  `).get(documentId) as
    | { id: string; name: string; owner_id: string; storage_path: string }
    | undefined;

  if (!doc) {
    throw new HttpError(404, 'DOCUMENT_NOT_FOUND', 'Document not found.');
  }

  const isAdmin = actor.roles.includes('ADMIN');
  if (!isAdmin && doc.owner_id !== actor.id) {
    throw new HttpError(403, 'FORBIDDEN', 'You are not permitted to delete this document.');
  }

  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    db.prepare(`UPDATE documents SET status = 'DELETING', updated_at = ? WHERE id = ?`).run(now, doc.id);
    db.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(doc.id);
    db.prepare('DELETE FROM document_permissions WHERE document_id = ?').run(doc.id);
    db.prepare(`UPDATE documents SET status = 'DELETED', chunk_count = 0, updated_at = ? WHERE id = ?`).run(
      now,
      doc.id
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const docDir = path.join(config.uploadDir, doc.id);
  if (fs.existsSync(docDir)) {
    fs.rmSync(docDir, { recursive: true, force: true });
  }

  recordAudit({
    actorUserId: actor.id,
    actorEmail: actor.email,
    action: 'DOCUMENT_DELETED',
    resourceType: 'DOCUMENT',
    resourceId: doc.id,
    details: { name: doc.name },
    correlationId,
    ipAddress,
  });
}

export function userCanViewDocument(user: AuthUser, docId: string): boolean {
  const db = getDb();
  const row = db.prepare(`
    SELECT d.id
    FROM documents d
    WHERE d.id = ?
      AND d.status != 'DELETED'
      AND (
        ? = 1
        OR d.owner_id = ?
        OR d.access_scope = 'ALL_EMPLOYEES'
        OR (
          d.access_scope = 'DEPARTMENT'
          AND d.department_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM department_members dm
            WHERE dm.department_id = d.department_id AND dm.user_id = ?
          )
        )
        OR (
          d.access_scope = 'RESTRICTED'
          AND EXISTS (
            SELECT 1 FROM document_permissions dp
            WHERE dp.document_id = d.id AND dp.user_id = ?
          )
        )
      )
  `).get(docId, user.roles.includes('ADMIN') ? 1 : 0, user.id, user.id, user.id);
  return Boolean(row);
}

export function listVisibleDocuments(
  user: AuthUser,
  filters?: { search?: string; status?: string; scope?: string; departmentId?: string }
): DocumentDto[] {
  const db = getDb();
  const isAdmin = user.roles.includes('ADMIN');
  const params: Array<string | number> = [isAdmin ? 1 : 0, user.id, user.id, user.id];

  let whereExtra = '';
  if (filters?.status) {
    whereExtra += ' AND d.status = ?';
    params.push(filters.status);
  }
  if (filters?.scope) {
    whereExtra += ' AND d.access_scope = ?';
    params.push(filters.scope);
  }
  if (filters?.departmentId) {
    whereExtra += ' AND d.department_id = ?';
    params.push(filters.departmentId);
  }
  if (filters?.search) {
    whereExtra += ' AND (LOWER(d.name) LIKE ? OR LOWER(d.original_filename) LIKE ?)';
    const pat = `%${filters.search.toLowerCase()}%`;
    params.push(pat, pat);
  }

  const rows = db.prepare(`
    SELECT
      d.*,
      u.full_name AS owner_name,
      dept.name AS department_name
    FROM documents d
    INNER JOIN users u ON u.id = d.owner_id
    LEFT JOIN departments dept ON dept.id = d.department_id
    WHERE d.status != 'DELETED'
      AND (
        ? = 1
        OR d.owner_id = ?
        OR d.access_scope = 'ALL_EMPLOYEES'
        OR (
          d.access_scope = 'DEPARTMENT'
          AND d.department_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM department_members dm
            WHERE dm.department_id = d.department_id AND dm.user_id = ?
          )
        )
        OR (
          d.access_scope = 'RESTRICTED'
          AND EXISTS (
            SELECT 1 FROM document_permissions dp
            WHERE dp.document_id = d.id AND dp.user_id = ?
          )
        )
      )
      ${whereExtra}
    ORDER BY d.updated_at DESC
  `).all(...params) as Array<Record<string, unknown>>;

  return rows.map(mapDocumentRow);
}

export function getDocumentById(docId: string, user: AuthUser): DocumentDto | null {
  if (!userCanViewDocument(user, docId)) {
    return null;
  }
  const db = getDb();
  const row = db.prepare(`
    SELECT
      d.*,
      u.full_name AS owner_name,
      dept.name AS department_name
    FROM documents d
    INNER JOIN users u ON u.id = d.owner_id
    LEFT JOIN departments dept ON dept.id = d.department_id
    WHERE d.id = ? AND d.status != 'DELETED'
  `).get(docId) as Record<string, unknown> | undefined;

  return row ? mapDocumentRow(row) : null;
}

function mapDocumentRow(row: Record<string, unknown>): DocumentDto {
  return {
    id: String(row.id),
    name: String(row.name),
    originalFilename: String(row.original_filename),
    mimeType: String(row.mime_type),
    fileType: String(row.file_type),
    fileSizeBytes: Number(row.file_size_bytes),
    checksumSha256: String(row.checksum_sha256),
    ownerId: String(row.owner_id),
    ownerName: String(row.owner_name || ''),
    departmentId: row.department_id ? String(row.department_id) : null,
    departmentName: row.department_name ? String(row.department_name) : null,
    accessScope: String(row.access_scope) as AccessScope,
    status: String(row.status),
    currentVersion: Number(row.current_version),
    chunkCount: Number(row.chunk_count),
    processingError: row.processing_error ? String(row.processing_error) : null,
    createdAt: String(row.created_at),
    processedAt: row.processed_at ? String(row.processed_at) : null,
    updatedAt: String(row.updated_at),
  };
}
