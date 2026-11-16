import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db.js';
import { executeRagChat } from '../rag/ragOrchestrator.js';
import { HttpError } from '../security/authService.js';
import { requireAuth } from '../security/middleware.js';

export const chatRouter = Router();
export const conversationRouter = Router();
export const feedbackRouter = Router();

chatRouter.use(requireAuth);
conversationRouter.use(requireAuth);
feedbackRouter.use(requireAuth);

chatRouter.post('/', async (req, res, next) => {
  try {
    const { question, message, conversationId, departmentId, documentId } = req.body || {};
    const q = question || message;
    if (!q || typeof q !== 'string') {
      throw new HttpError(400, 'VALIDATION_ERROR', 'question is required.');
    }

    const result = await executeRagChat({
      user: req.authUser!,
      question: q,
      conversationId: conversationId ? String(conversationId) : undefined,
      departmentId: departmentId ? String(departmentId) : undefined,
      documentId: documentId ? String(documentId) : undefined,
      correlationId: req.correlationId,
      ipAddress: req.ip,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

conversationRouter.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      c.id,
      c.title,
      c.created_at,
      c.updated_at,
      COUNT(m.id) AS message_count
    FROM conversations c
    LEFT JOIN conversation_messages m ON m.conversation_id = c.id
    WHERE c.user_id = ?
    GROUP BY c.id
    ORDER BY c.updated_at DESC
  `).all(req.authUser!.id) as Array<{
    id: string;
    title: string;
    created_at: string;
    updated_at: string;
    message_count: number;
  }>;

  res.json({
    conversations: rows.map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      messageCount: Number(r.message_count),
    })),
  });
});

conversationRouter.post('/', (req, res) => {
  const db = getDb();
  const id = uuidv4();
  const now = new Date().toISOString();
  const title =
    req.body?.title && String(req.body.title).trim()
      ? String(req.body.title).trim().slice(0, 120)
      : 'New Conversation';

  db.prepare(`
    INSERT INTO conversations (id, user_id, title, summary, created_at, updated_at)
    VALUES (?, ?, ?, '', ?, ?)
  `).run(id, req.authUser!.id, title, now, now);

  res.status(201).json({ id, title, createdAt: now, updatedAt: now, messageCount: 0 });
});

conversationRouter.get('/:id/messages', (req, res, next) => {
  try {
    const db = getDb();
    const conv = db.prepare('SELECT id, user_id, title FROM conversations WHERE id = ?').get(
      req.params.id
    ) as { id: string; user_id: string; title: string } | undefined;

    if (!conv) {
      throw new HttpError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
    }
    if (conv.user_id !== req.authUser!.id) {
      throw new HttpError(403, 'FORBIDDEN', 'You do not have access to this conversation.');
    }

    const rows = db.prepare(`
      SELECT id, role, content, confidence, citations_json, follow_up_json, retrieval_metadata_json, created_at
      FROM conversation_messages
      WHERE conversation_id = ?
      ORDER BY created_at ASC
    `).all(conv.id) as Array<Record<string, unknown>>;

    const messages = rows.map((m) => ({
      id: String(m.id),
      role: String(m.role),
      content: String(m.content),
      confidence: m.confidence ? String(m.confidence) : null,
      citations: m.citations_json ? JSON.parse(String(m.citations_json)) : [],
      followUpQuestions: m.follow_up_json ? JSON.parse(String(m.follow_up_json)) : [],
      retrievalMetadata: m.retrieval_metadata_json
        ? JSON.parse(String(m.retrieval_metadata_json))
        : null,
      createdAt: String(m.created_at),
    }));

    res.json({ conversation: { id: conv.id, title: conv.title }, messages });
  } catch (err) {
    next(err);
  }
});

conversationRouter.patch('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const conv = db.prepare('SELECT id, user_id FROM conversations WHERE id = ?').get(req.params.id) as
      | { id: string; user_id: string }
      | undefined;

    if (!conv) {
      throw new HttpError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
    }
    if (conv.user_id !== req.authUser!.id) {
      throw new HttpError(403, 'FORBIDDEN', 'Access denied.');
    }
    const title = req.body?.title ? String(req.body.title).trim() : '';
    if (!title) {
      throw new HttpError(400, 'INVALID_TITLE', 'title is required.');
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?').run(
      title.slice(0, 120),
      now,
      conv.id
    );
    res.json({ id: conv.id, title: title.slice(0, 120), updatedAt: now });
  } catch (err) {
    next(err);
  }
});

conversationRouter.delete('/:id', (req, res, next) => {
  try {
    const db = getDb();
    const conv = db.prepare('SELECT id, user_id FROM conversations WHERE id = ?').get(req.params.id) as
      | { id: string; user_id: string }
      | undefined;

    if (!conv) {
      throw new HttpError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
    }
    if (conv.user_id !== req.authUser!.id) {
      throw new HttpError(403, 'FORBIDDEN', 'Access denied.');
    }
    db.prepare('DELETE FROM conversations WHERE id = ?').run(conv.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

feedbackRouter.post('/', (req, res, next) => {
  try {
    const { messageId, rating, comment } = req.body || {};
    if (!messageId || !['UP', 'DOWN'].includes(rating)) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'messageId and rating (UP or DOWN) are required.');
    }

    const db = getDb();
    const msg = db.prepare(`
      SELECT m.id, c.user_id
      FROM conversation_messages m
      INNER JOIN conversations c ON c.id = m.conversation_id
      WHERE m.id = ?
    `).get(String(messageId)) as { id: string; user_id: string } | undefined;

    if (!msg) {
      throw new HttpError(404, 'MESSAGE_NOT_FOUND', 'Message not found.');
    }
    if (msg.user_id !== req.authUser!.id) {
      throw new HttpError(403, 'FORBIDDEN', 'You can only rate messages in your own conversations.');
    }

    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO user_feedback (id, message_id, user_id, rating, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id, user_id) DO UPDATE SET
        rating = excluded.rating,
        comment = excluded.comment,
        created_at = excluded.created_at
    `).run(
      uuidv4(),
      msg.id,
      req.authUser!.id,
      rating,
      comment ? String(comment).slice(0, 500) : null,
      now
    );

    res.status(201).json({ messageId: msg.id, rating });
  } catch (err) {
    next(err);
  }
});
