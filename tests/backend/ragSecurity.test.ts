import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app.js';
import { config } from '../../server/config.js';
import { getDb, resetDbForTests } from '../../server/db.js';
import { ABSTENTION_MESSAGE, setLlmProviderForTest } from '../../server/llm/llmProvider.js';
import { clearLoginAttemptsForTest } from '../../server/security/authService.js';
import { ensureSeedData } from '../../server/seed.js';

describe('KnowledgeAssist Full-Stack API & RAG Security Integration', () => {
  let app: ReturnType<typeof createApp>;
  let tmpDir: string;
  let adminToken: string;
  let engToken: string;
  let financeToken: string;
  let engDeptId: string;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ka-test-'));
    config.uploadDir = path.join(tmpDir, 'uploads');
    resetDbForTests();
    getDb(path.join(tmpDir, 'test.db'));
    await ensureSeedData();
    clearLoginAttemptsForTest();
    app = createApp();

    const adminLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'admin@knowledgeassist.local',
      password: process.env.DEMO_SEED_PASSWORD || 'KnowledgeDemo!2026',
    });
    expect(adminLogin.status).toBe(200);
    adminToken = adminLogin.body.accessToken;

    const engLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'alex.eng@knowledgeassist.local',
      password: process.env.DEMO_SEED_PASSWORD || 'KnowledgeDemo!2026',
    });
    expect(engLogin.status).toBe(200);
    engToken = engLogin.body.accessToken;

    const finLogin = await request(app).post('/api/v1/auth/login').send({
      email: 'sam.finance@knowledgeassist.local',
      password: process.env.DEMO_SEED_PASSWORD || 'KnowledgeDemo!2026',
    });
    expect(finLogin.status).toBe(200);
    financeToken = finLogin.body.accessToken;

    const deptsRes = await request(app)
      .get('/api/v1/departments')
      .set('Authorization', `Bearer ${adminToken}`);
    const engDept = deptsRes.body.departments.find((d: { name: string }) => d.name === 'Engineering');
    engDeptId = engDept.id;
  });

  afterAll(() => {
    setLlmProviderForTest(null);
    resetDbForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('registers a new employee, rotates refresh token, detects reuse, and logs out', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send({
      email: 'new.hire@knowledgeassist.local',
      fullName: 'Taylor Brooks',
      password: 'StrongPassword123',
      roles: ['ADMIN'], // Must be ignored by server!
    });
    expect(reg.status).toBe(201);
    expect(reg.body.user.roles).toEqual(['EMPLOYEE']);

    const refreshRes = await request(app).post('/api/v1/auth/refresh').send({
      refreshToken: reg.body.refreshToken,
    });
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.refreshToken).not.toBe(reg.body.refreshToken);

    // Reusing rotated token must fail
    const reuseRes = await request(app).post('/api/v1/auth/refresh').send({
      refreshToken: reg.body.refreshToken,
    });
    expect(reuseRes.status).toBe(401);

    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${refreshRes.body.accessToken}`)
      .send({ refreshToken: refreshRes.body.refreshToken });
    expect(logoutRes.status).toBe(204);
  });

  it('enforces brute-force login rate limiting', async () => {
    for (let i = 0; i < config.security.maxLoginAttempts; i += 1) {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: 'bruteforce@knowledgeassist.local',
        password: 'WrongPassword123',
      });
      expect(res.status).toBe(401);
    }
    const locked = await request(app).post('/api/v1/auth/login').send({
      email: 'bruteforce@knowledgeassist.local',
      password: 'WrongPassword123',
    });
    expect(locked.status).toBe(429);
  });

  it('answers grounded questions with verified citations from ALL_EMPLOYEES documents', async () => {
    const chatRes = await request(app)
      .post('/api/v1/chat')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        question: 'How many weeks of paid parental leave are employees eligible for?',
      });

    expect(chatRes.status).toBe(200);
    expect(chatRes.body.retrievalMetadata.abstained).toBe(false);
    expect(chatRes.body.answer).toContain('16 weeks');
    expect(chatRes.body.citations.length).toBeGreaterThan(0);
    expect(chatRes.body.citations[0].documentName).toBe('Employee_Handbook_2026');
  });

  it('strictly abstains when evidence is missing from authorized documents', async () => {
    const chatRes = await request(app)
      .post('/api/v1/chat')
      .set('Authorization', `Bearer ${engToken}`)
      .send({
        question: 'What is the submarine nuclear propulsion maintenance schedule?',
      });

    expect(chatRes.status).toBe(200);
    expect(chatRes.body.answer).toBe(ABSTENTION_MESSAGE);
    expect(chatRes.body.citations).toEqual([]);
    expect(chatRes.body.confidence).toBe('LOW');
  });

  it('prevents cross-department and restricted document retrieval leakage', async () => {
    // Engineering employee CAN query Engineering Incident Response SOP
    const engAllowed = await request(app)
      .post('/api/v1/chat')
      .set('Authorization', `Bearer ${engToken}`)
      .send({
        question: 'What is the SEV-1 initial acknowledgement SLA?',
      });
    expect(engAllowed.status).toBe(200);
    expect(engAllowed.body.answer).toContain('5 minutes');
    expect(engAllowed.body.citations[0].documentName).toBe('Engineering_Incident_Response_SOP');

    // Finance employee CANNOT retrieve Engineering SOP or Restricted SOC 2 Audit
    const finBlockedEng = await request(app)
      .post('/api/v1/chat')
      .set('Authorization', `Bearer ${financeToken}`)
      .send({
        question: 'What is the SEV-1 initial acknowledgement SLA?',
      });
    expect(finBlockedEng.status).toBe(200);
    expect(finBlockedEng.body.answer).toBe(ABSTENTION_MESSAGE);
    expect(finBlockedEng.body.citations).toEqual([]);

    const engBlockedAudit = await request(app)
      .post('/api/v1/chat')
      .set('Authorization', `Bearer ${engToken}`)
      .send({
        question: 'What is Observation SEC-09 about KMS key rotation?',
      });
    expect(engBlockedAudit.status).toBe(200);
    expect(engBlockedAudit.body.answer).toBe(ABSTENTION_MESSAGE);
    expect(engBlockedAudit.body.citations).toEqual([]);
  });

  it('rejects fabricated citations produced by an untrusted LLM output', async () => {
    setLlmProviderForTest({
      modelName: 'test-fabricated-citation-llm',
      async generateGroundedAnswer() {
        return {
          answer: 'Fabricated policy says 99 days PTO.',
          abstained: false,
          citedChunkIds: ['00000000-0000-0000-0000-000000000000'],
          followUpQuestions: [],
          tokenUsage: 10,
          modelName: 'test-fabricated-citation-llm',
        };
      },
    });

    const res = await request(app)
      .post('/api/v1/chat')
      .set('Authorization', `Bearer ${engToken}`)
      .send({ question: 'How many days of PTO do employees accrue?' });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe(ABSTENTION_MESSAGE);
    expect(res.body.citations).toEqual([]);
    setLlmProviderForTest(null);
  });

  it('supports document upload, duplicate rejection, version replacement, and safe deletion', async () => {
    const contentV1 = '# On-Call Runbook\n\nPrimary rotation starts Monday at 09:00 UTC.';
    const uploadRes = await request(app)
      .post('/api/v1/documents/upload?sync=true')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('accessScope', 'DEPARTMENT')
      .field('departmentId', engDeptId)
      .attach('file', Buffer.from(contentV1, 'utf8'), 'oncall_runbook.md');

    expect(uploadRes.status).toBe(202);
    const docId = uploadRes.body.document.id;

    // Duplicate checksum upload must return 409
    const dupRes = await request(app)
      .post('/api/v1/documents/upload?sync=true')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('accessScope', 'ALL_EMPLOYEES')
      .attach('file', Buffer.from(contentV1, 'utf8'), 'oncall_copy.md');
    expect(dupRes.status).toBe(409);

    // Replace with v2
    const contentV2 = '# On-Call Runbook v2\n\nPrimary rotation starts Tuesday at 10:00 UTC.';
    const replaceRes = await request(app)
      .post(`/api/v1/documents/${docId}/replace?sync=true`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('changeNote', 'Shifted rotation handoff to Tuesday')
      .attach('file', Buffer.from(contentV2, 'utf8'), 'oncall_runbook_v2.md');
    expect(replaceRes.status).toBe(202);
    expect(replaceRes.body.document.currentVersion).toBe(2);

    const versionsRes = await request(app)
      .get(`/api/v1/documents/${docId}/versions`)
      .set('Authorization', `Bearer ${engToken}`);
    expect(versionsRes.status).toBe(200);
    expect(versionsRes.body.versions.length).toBe(2);

    // Delete safely
    const delRes = await request(app)
      .delete(`/api/v1/documents/${docId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delRes.status).toBe(204);

    const afterDel = await request(app)
      .get(`/api/v1/documents/${docId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(afterDel.status).toBe(404);
  });

  it('isolates conversations between users and exposes real analytics and health endpoints', async () => {
    const convCreate = await request(app)
      .post('/api/v1/conversations')
      .set('Authorization', `Bearer ${engToken}`)
      .send({ title: 'Private Engineering Thread' });
    expect(convCreate.status).toBe(201);

    const otherAccess = await request(app)
      .get(`/api/v1/conversations/${convCreate.body.id}/messages`)
      .set('Authorization', `Bearer ${financeToken}`);
    expect(otherAccess.status).toBe(403);

    const analyticsRes = await request(app)
      .get('/api/v1/admin/analytics')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(analyticsRes.status).toBe(200);
    expect(analyticsRes.body.queries.total).toBeGreaterThan(0);

    const healthRes = await request(app).get('/actuator/health');
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe('UP');

    const promRes = await request(app).get('/actuator/prometheus');
    expect(promRes.status).toBe(200);
    expect(promRes.text).toContain('knowledgeassist_queries_total');
  });
});
