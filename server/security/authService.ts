import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config.js';
import { getDb } from '../db.js';
import type { AuthUser, RoleName } from '../types.js';
import { recordAudit } from '../audit/auditService.js';

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface LoginAttemptState {
  count: number;
  firstAttemptAt: number;
  lockedUntil?: number;
}

const loginAttemptStore = new Map<string, LoginAttemptState>();

export function clearLoginAttemptsForTest(): void {
  loginAttemptStore.clear();
}

function checkRateLimit(key: string): void {
  const now = Date.now();
  const state = loginAttemptStore.get(key);
  if (!state) return;
  if (state.lockedUntil && now < state.lockedUntil) {
    const retrySeconds = Math.ceil((state.lockedUntil - now) / 1000);
    throw new HttpError(
      429,
      'TOO_MANY_ATTEMPTS',
      `Too many failed login attempts. Try again in ${retrySeconds} seconds.`
    );
  }
  if (now - state.firstAttemptAt > config.security.loginWindowMs) {
    loginAttemptStore.delete(key);
  }
}

function recordFailedLoginAttempt(key: string): void {
  const now = Date.now();
  const existing = loginAttemptStore.get(key);
  if (!existing || now - existing.firstAttemptAt > config.security.loginWindowMs) {
    loginAttemptStore.set(key, { count: 1, firstAttemptAt: now });
    return;
  }
  const nextCount = existing.count + 1;
  const lockedUntil =
    nextCount >= config.security.maxLoginAttempts
      ? now + config.security.loginWindowMs
      : undefined;
  loginAttemptStore.set(key, {
    count: nextCount,
    firstAttemptAt: existing.firstAttemptAt,
    lockedUntil,
  });
}

function clearLoginAttempt(key: string): void {
  loginAttemptStore.delete(key);
}

export function validatePasswordStrength(password: string): void {
  if (typeof password !== 'string' || password.length < 8) {
    throw new HttpError(400, 'WEAK_PASSWORD', 'Password must be at least 8 characters long.');
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new HttpError(
      400,
      'WEAK_PASSWORD',
      'Password must include uppercase, lowercase, and numeric characters.'
    );
  }
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function loadAuthUserById(userId: string): AuthUser | null {
  const db = getDb();
  const userRow = db.prepare(`
    SELECT id, email, full_name, is_active FROM users WHERE id = ?
  `).get(userId) as { id: string; email: string; full_name: string; is_active: number } | undefined;

  if (!userRow) return null;

  const roleRows = db.prepare(`
    SELECT r.name FROM roles r
    INNER JOIN user_roles ur ON ur.role_id = r.id
    WHERE ur.user_id = ?
  `).all(userId) as Array<{ name: RoleName }>;

  const deptRows = db.prepare(`
    SELECT department_id FROM department_members WHERE user_id = ?
  `).all(userId) as Array<{ department_id: string }>;

  return {
    id: userRow.id,
    email: userRow.email,
    fullName: userRow.full_name,
    isActive: userRow.is_active === 1,
    roles: roleRows.map((r) => r.name),
    departmentIds: deptRows.map((d) => d.department_id),
  };
}

function issueTokenPair(user: AuthUser): {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
} {
  const db = getDb();
  const accessToken = jwt.sign(
    { sub: user.id, email: user.email, roles: user.roles, type: 'access' },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessTtlSeconds }
  );

  const refreshTokenId = uuidv4();
  const refreshToken = jwt.sign(
    { sub: user.id, jti: refreshTokenId, type: 'refresh' },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshTtlSeconds }
  );

  const expiresAt = new Date(Date.now() + config.jwt.refreshTtlSeconds * 1000).toISOString();
  db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(refreshTokenId, user.id, hashToken(refreshToken), expiresAt, new Date().toISOString());

  return {
    accessToken,
    refreshToken,
    expiresIn: config.jwt.accessTtlSeconds,
  };
}

export async function registerUser(input: {
  email: string;
  fullName: string;
  password: string;
  correlationId?: string;
  ipAddress?: string;
}): Promise<{ user: AuthUser; accessToken: string; refreshToken: string; expiresIn: number }> {
  if (!config.security.allowSelfRegistration) {
    throw new HttpError(403, 'REGISTRATION_DISABLED', 'Self-registration is disabled by policy.');
  }

  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'INVALID_EMAIL', 'Please provide a valid corporate email address.');
  }
  if (fullName.length < 2 || fullName.length > 120) {
    throw new HttpError(400, 'INVALID_NAME', 'Full name must be between 2 and 120 characters.');
  }
  validatePasswordStrength(input.password);

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    throw new HttpError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
  }

  const userId = uuidv4();
  const now = new Date().toISOString();
  const passwordHash = await bcrypt.hash(input.password, 10);

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(userId, email, fullName, passwordHash, now, now);

    // Never trust role submitted from frontend; self-registration always assigns EMPLOYEE role.
    const employeeRole = db.prepare('SELECT id FROM roles WHERE name = ?').get('EMPLOYEE') as
      | { id: string }
      | undefined;
    if (!employeeRole) {
      throw new Error('EMPLOYEE role is missing in database.');
    }
    db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(userId, employeeRole.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const authUser = loadAuthUserById(userId)!;
  const tokens = issueTokenPair(authUser);

  recordAudit({
    actorUserId: authUser.id,
    actorEmail: authUser.email,
    action: 'USER_REGISTERED',
    resourceType: 'USER',
    resourceId: authUser.id,
    correlationId: input.correlationId,
    ipAddress: input.ipAddress,
  });

  return { user: authUser, ...tokens };
}

export async function loginUser(input: {
  email: string;
  password: string;
  correlationId?: string;
  ipAddress?: string;
}): Promise<{ user: AuthUser; accessToken: string; refreshToken: string; expiresIn: number }> {
  const email = input.email.trim().toLowerCase();
  const rateKey = `${email}:${input.ipAddress || 'unknown'}`;
  checkRateLimit(rateKey);

  const db = getDb();
  const row = db.prepare(`
    SELECT id, email, password_hash, is_active FROM users WHERE email = ?
  `).get(email) as
    | { id: string; email: string; password_hash: string; is_active: number }
    | undefined;

  if (!row) {
    recordFailedLoginAttempt(rateKey);
    recordAudit({
      actorEmail: email,
      action: 'LOGIN_FAILED',
      resourceType: 'AUTH',
      details: { reason: 'unknown_email' },
      correlationId: input.correlationId,
      ipAddress: input.ipAddress,
    });
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  if (row.is_active !== 1) {
    recordAudit({
      actorUserId: row.id,
      actorEmail: row.email,
      action: 'LOGIN_BLOCKED_INACTIVE',
      resourceType: 'AUTH',
      correlationId: input.correlationId,
      ipAddress: input.ipAddress,
    });
    throw new HttpError(403, 'ACCOUNT_INACTIVE', 'Your account has been deactivated by an administrator.');
  }

  const valid = await bcrypt.compare(input.password, row.password_hash);
  if (!valid) {
    recordFailedLoginAttempt(rateKey);
    recordAudit({
      actorUserId: row.id,
      actorEmail: row.email,
      action: 'LOGIN_FAILED',
      resourceType: 'AUTH',
      details: { reason: 'invalid_password' },
      correlationId: input.correlationId,
      ipAddress: input.ipAddress,
    });
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  clearLoginAttempt(rateKey);
  const authUser = loadAuthUserById(row.id)!;
  const tokens = issueTokenPair(authUser);

  recordAudit({
    actorUserId: authUser.id,
    actorEmail: authUser.email,
    action: 'LOGIN_SUCCESS',
    resourceType: 'AUTH',
    correlationId: input.correlationId,
    ipAddress: input.ipAddress,
  });

  return { user: authUser, ...tokens };
}

export function rotateRefreshToken(input: {
  refreshToken: string;
  correlationId?: string;
  ipAddress?: string;
}): { user: AuthUser; accessToken: string; refreshToken: string; expiresIn: number } {
  let payload: { sub: string; jti: string; type: string };
  try {
    payload = jwt.verify(input.refreshToken, config.jwt.refreshSecret) as {
      sub: string;
      jti: string;
      type: string;
    };
  } catch {
    throw new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired.');
  }

  if (payload.type !== 'refresh') {
    throw new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Invalid token type.');
  }

  const db = getDb();
  const tokenHash = hashToken(input.refreshToken);
  const stored = db.prepare(`
    SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash = ?
  `).get(tokenHash) as
    | { id: string; user_id: string; expires_at: string; revoked_at: string | null }
    | undefined;

  if (!stored) {
    throw new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token not recognized.');
  }

  if (stored.revoked_at) {
    // Token reuse detected — revoke all active refresh tokens for this user
    db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(
      new Date().toISOString(),
      stored.user_id
    );
    recordAudit({
      actorUserId: stored.user_id,
      action: 'REFRESH_TOKEN_REUSE_DETECTED',
      resourceType: 'AUTH',
      correlationId: input.correlationId,
      ipAddress: input.ipAddress,
    });
    throw new HttpError(401, 'TOKEN_REVOKED', 'Refresh token has already been rotated or revoked.');
  }

  if (new Date(stored.expires_at).getTime() < Date.now()) {
    throw new HttpError(401, 'TOKEN_EXPIRED', 'Refresh token has expired.');
  }

  const user = loadAuthUserById(stored.user_id);
  if (!user || !user.isActive) {
    throw new HttpError(403, 'ACCOUNT_INACTIVE', 'User account is inactive.');
  }

  const nextTokens = issueTokenPair(user);
  const nextRow = db.prepare('SELECT id FROM refresh_tokens WHERE token_hash = ?').get(
    hashToken(nextTokens.refreshToken)
  ) as { id: string };

  db.prepare('UPDATE refresh_tokens SET revoked_at = ?, replaced_by_token_id = ? WHERE id = ?').run(
    new Date().toISOString(),
    nextRow.id,
    stored.id
  );

  return { user, ...nextTokens };
}

export function logoutSession(input: {
  userId: string;
  email: string;
  refreshToken?: string;
  correlationId?: string;
  ipAddress?: string;
}): void {
  const db = getDb();
  const now = new Date().toISOString();
  if (input.refreshToken) {
    db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND user_id = ?').run(
      now,
      hashToken(input.refreshToken),
      input.userId
    );
  } else {
    db.prepare('UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(
      now,
      input.userId
    );
  }

  recordAudit({
    actorUserId: input.userId,
    actorEmail: input.email,
    action: 'LOGOUT',
    resourceType: 'AUTH',
    correlationId: input.correlationId,
    ipAddress: input.ipAddress,
  });
}

export function verifyAccessToken(token: string): AuthUser {
  let payload: { sub: string; type: string };
  try {
    payload = jwt.verify(token, config.jwt.accessSecret) as { sub: string; type: string };
  } catch {
    throw new HttpError(401, 'UNAUTHORIZED', 'Access token is invalid or expired.');
  }
  if (payload.type !== 'access') {
    throw new HttpError(401, 'UNAUTHORIZED', 'Invalid token type.');
  }
  const user = loadAuthUserById(payload.sub);
  if (!user) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Authenticated user no longer exists.');
  }
  if (!user.isActive) {
    throw new HttpError(403, 'ACCOUNT_INACTIVE', 'User account is deactivated.');
  }
  return user;
}
