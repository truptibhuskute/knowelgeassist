import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { recordAudit } from '../audit/auditService.js';
import { getDb } from '../db.js';
import { HttpError, loadAuthUserById } from '../security/authService.js';
import { requireAuth, requireRole } from '../security/middleware.js';
import type { RoleName } from '../types.js';

export const userRouter = Router();
export const departmentRouter = Router();

userRouter.use(requireAuth);
departmentRouter.use(requireAuth);

userRouter.get('/me', (req, res) => {
  const db = getDb();
  const user = req.authUser!;
  const departments = db.prepare(`
    SELECT d.id, d.name, d.description
    FROM departments d
    INNER JOIN department_members dm ON dm.department_id = d.id
    WHERE dm.user_id = ?
    ORDER BY d.name ASC
  `).all(user.id);

  res.json({
    ...user,
    departments,
  });
});

userRouter.get('/', requireRole('ADMIN', 'KNOWLEDGE_OWNER'), (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, email, full_name, is_active, created_at, updated_at
    FROM users
    ORDER BY created_at DESC
  `).all() as Array<{
    id: string;
    email: string;
    full_name: string;
    is_active: number;
    created_at: string;
    updated_at: string;
  }>;

  const result = rows.map((row) => {
    const authUser = loadAuthUserById(row.id)!;
    return {
      ...authUser,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
  res.json({ users: result });
});

userRouter.get('/:id', (req, res, next) => {
  try {
    const targetId = req.params.id;
    const isAdmin = req.authUser!.roles.includes('ADMIN');
    if (!isAdmin && req.authUser!.id !== targetId) {
      throw new HttpError(403, 'FORBIDDEN', 'You can only view your own profile.');
    }
    const target = loadAuthUserById(targetId);
    if (!target) {
      throw new HttpError(404, 'USER_NOT_FOUND', 'User not found.');
    }
    res.json(target);
  } catch (err) {
    next(err);
  }
});

userRouter.patch('/:id', requireRole('ADMIN'), (req, res, next) => {
  try {
    const targetId = req.params.id;
    const existing = loadAuthUserById(targetId);
    if (!existing) {
      throw new HttpError(404, 'USER_NOT_FOUND', 'User not found.');
    }

    const { isActive, roles, departmentIds, fullName } = req.body || {};
    const db = getDb();
    const now = new Date().toISOString();

    db.exec('BEGIN');
    try {
      if (typeof isActive === 'boolean') {
        db.prepare('UPDATE users SET is_active = ?, updated_at = ? WHERE id = ?').run(
          isActive ? 1 : 0,
          now,
          targetId
        );
        if (!isActive) {
          db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(
            now,
            targetId
          );
        }
      }

      if (typeof fullName === 'string' && fullName.trim().length >= 2) {
        db.prepare('UPDATE users SET full_name = ?, updated_at = ? WHERE id = ?').run(
          fullName.trim(),
          now,
          targetId
        );
      }

      if (Array.isArray(roles)) {
        const validRoles: RoleName[] = ['EMPLOYEE', 'KNOWLEDGE_OWNER', 'ADMIN'];
        const normalized = roles.filter((r): r is RoleName => validRoles.includes(r));
        if (normalized.length === 0) {
          throw new HttpError(400, 'INVALID_ROLES', 'At least one valid role must be assigned.');
        }
        db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(targetId);
        const roleLookup = db.prepare('SELECT id FROM roles WHERE name = ?');
        const insertRole = db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)');
        for (const rName of normalized) {
          const rRow = roleLookup.get(rName) as { id: string } | undefined;
          if (rRow) insertRole.run(targetId, rRow.id);
        }
      }

      if (Array.isArray(departmentIds)) {
        db.prepare('DELETE FROM department_members WHERE user_id = ?').run(targetId);
        const insertDept = db.prepare(
          'INSERT OR IGNORE INTO department_members (department_id, user_id, assigned_at) VALUES (?, ?, ?)'
        );
        for (const dId of departmentIds) {
          insertDept.run(String(dId), targetId, now);
        }
      }

      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }

    const updated = loadAuthUserById(targetId)!;
    recordAudit({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'USER_UPDATED',
      resourceType: 'USER',
      resourceId: targetId,
      details: { isActive: updated.isActive, roles: updated.roles, departmentIds: updated.departmentIds },
      correlationId: req.correlationId,
      ipAddress: req.ip,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

departmentRouter.get('/', (_req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      d.id,
      d.name,
      d.description,
      d.created_at,
      COUNT(DISTINCT dm.user_id) AS member_count
    FROM departments d
    LEFT JOIN department_members dm ON dm.department_id = d.id
    GROUP BY d.id
    ORDER BY d.name ASC
  `).all() as Array<{
    id: string;
    name: string;
    description: string | null;
    created_at: string;
    member_count: number;
  }>;

  res.json({
    departments: rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      createdAt: r.created_at,
      memberCount: Number(r.member_count),
    })),
  });
});

departmentRouter.post('/', requireRole('ADMIN'), (req, res, next) => {
  try {
    const { name, description } = req.body || {};
    if (!name || String(name).trim().length < 2) {
      throw new HttpError(400, 'INVALID_DEPARTMENT', 'Department name must be at least 2 characters.');
    }
    const db = getDb();
    const trimmed = String(name).trim();
    const existing = db.prepare('SELECT id FROM departments WHERE LOWER(name) = LOWER(?)').get(trimmed);
    if (existing) {
      throw new HttpError(409, 'DEPARTMENT_EXISTS', 'Department with this name already exists.');
    }
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO departments (id, name, description, created_at) VALUES (?, ?, ?, ?)').run(
      id,
      trimmed,
      description ? String(description).trim() : null,
      now
    );

    recordAudit({
      actorUserId: req.authUser!.id,
      actorEmail: req.authUser!.email,
      action: 'DEPARTMENT_CREATED',
      resourceType: 'DEPARTMENT',
      resourceId: id,
      details: { name: trimmed },
      correlationId: req.correlationId,
      ipAddress: req.ip,
    });

    res.status(201).json({ id, name: trimmed, description: description || null, createdAt: now, memberCount: 0 });
  } catch (err) {
    next(err);
  }
});
