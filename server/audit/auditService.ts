import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';

export interface AuditEventInput {
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: Record<string, unknown>;
  correlationId?: string | null;
  ipAddress?: string | null;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'authorization',
  'secret',
]);

function scrubSensitive(obj?: Record<string, unknown>): Record<string, unknown> | null {
  if (!obj) return null;
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(k)) {
      cleaned[k] = '[REDACTED]';
    } else if (typeof v === 'string' && v.length > 500) {
      cleaned[k] = v.slice(0, 500) + '...';
    } else {
      cleaned[k] = v;
    }
  }
  return cleaned;
}

export function recordAudit(input: AuditEventInput): void {
  try {
    const db = getDb();
    const safeDetails = scrubSensitive(input.details);
    db.prepare(`
      INSERT INTO audit_logs (
        id, actor_user_id, actor_email, action, resource_type,
        resource_id, details_json, correlation_id, ip_address, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      input.actorUserId ?? null,
      input.actorEmail ?? null,
      input.action,
      input.resourceType,
      input.resourceId ?? null,
      safeDetails ? JSON.stringify(safeDetails) : null,
      input.correlationId ?? null,
      input.ipAddress ?? null,
      new Date().toISOString()
    );
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'audit_write_failed',
      message: err instanceof Error ? err.message : 'Unknown error',
    }));
  }
}
