import { Router } from 'express';
import { config } from '../config.js';
import {
  HttpError,
  loginUser,
  logoutSession,
  registerUser,
  rotateRefreshToken,
} from '../security/authService.js';
import { requireAuth } from '../security/middleware.js';

export const authRouter = Router();

authRouter.get('/policy', (_req, res) => {
  res.json({
    allowSelfRegistration: config.security.allowSelfRegistration,
    demoSeedEnabled: config.security.seedDemoData && !config.isProd,
    llmProvider: config.gemini.apiKey ? config.gemini.chatModel : 'deterministic-extractive-fallback-v1',
  });
});

authRouter.post('/register', async (req, res, next) => {
  try {
    const { email, fullName, password } = req.body || {};
    if (!email || !fullName || !password) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'email, fullName, and password are required.');
    }
    const result = await registerUser({
      email: String(email),
      fullName: String(fullName),
      password: String(password),
      correlationId: req.correlationId,
      ipAddress: req.ip,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'email and password are required.');
    }
    const result = await loginUser({
      email: String(email),
      password: String(password),
      correlationId: req.correlationId,
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/refresh', (req, res, next) => {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'refreshToken is required.');
    }
    const result = rotateRefreshToken({
      refreshToken: String(refreshToken),
      correlationId: req.correlationId,
      ipAddress: req.ip,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', requireAuth, (req, res, next) => {
  try {
    const { refreshToken } = req.body || {};
    logoutSession({
      userId: req.authUser!.id,
      email: req.authUser!.email,
      refreshToken: refreshToken ? String(refreshToken) : undefined,
      correlationId: req.correlationId,
      ipAddress: req.ip,
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
