import type { NextFunction, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { AuthUser, RoleName } from '../types.js';
import { HttpError, verifyAccessToken } from './authService.js';

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
      correlationId?: string;
    }
  }
}

export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('X-Correlation-Id');
  const correlationId = incoming && incoming.length <= 64 ? incoming : uuidv4();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next(new HttpError(401, 'UNAUTHORIZED', 'Missing or invalid Authorization header.'));
    return;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  try {
    req.authUser = verifyAccessToken(token);
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...allowedRoles: RoleName[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.authUser;
    if (!user) {
      next(new HttpError(401, 'UNAUTHORIZED', 'Authentication required.'));
      return;
    }
    const hasRole = user.roles.some((r) => allowedRoles.includes(r));
    if (!hasRole) {
      next(
        new HttpError(
          403,
          'FORBIDDEN',
          `Insufficient permissions. Required role: ${allowedRoles.join(' or ')}.`
        )
      );
      return;
    }
    next();
  };
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const correlationId = req.correlationId;

  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        correlationId,
      },
    });
    return;
  }

  // Handle Multer errors cleanly
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = String((err as { code: unknown }).code);
    if (code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: {
          code: 'FILE_TOO_LARGE',
          message: 'Uploaded file exceeds the maximum allowed size (50 MB).',
          correlationId,
        },
      });
      return;
    }
  }

  console.error(
    JSON.stringify({
      level: 'error',
      event: 'unhandled_exception',
      correlationId,
      path: req.path,
      method: req.method,
      message: err instanceof Error ? err.message : 'Unknown error',
    })
  );

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal error occurred.',
      correlationId,
    },
  });
}
