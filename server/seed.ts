import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config.js';
import { getDb } from './db.js';
import { createUploadedDocument } from './ingestion/ingestionService.js';
import { loadAuthUserById } from './security/authService.js';

export async function ensureSeedData(): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  // Always ensure canonical roles exist
  const roles = ['EMPLOYEE', 'KNOWLEDGE_OWNER', 'ADMIN'] as const;
  for (const roleName of roles) {
    const existing = db.prepare('SELECT id FROM roles WHERE name = ?').get(roleName);
    if (!existing) {
      db.prepare('INSERT INTO roles (id, name) VALUES (?, ?)').run(uuidv4(), roleName);
    }
  }

  // Ensure standard enterprise departments exist
  const deptDefs = [
    { name: 'Engineering', description: 'Platform, infrastructure, and software engineering teams' },
    { name: 'Human Resources', description: 'People operations, benefits, leave, and onboarding' },
    { name: 'Finance & Legal', description: 'Expense policies, procurement, and compliance' },
    { name: 'Security', description: 'Information security, access control, and SOC 2 compliance' },
  ];

  const deptIds: Record<string, string> = {};
  for (const d of deptDefs) {
    const existing = db.prepare('SELECT id FROM departments WHERE name = ?').get(d.name) as
      | { id: string }
      | undefined;
    if (existing) {
      deptIds[d.name] = existing.id;
    } else {
      const id = uuidv4();
      db.prepare('INSERT INTO departments (id, name, description, created_at) VALUES (?, ?, ?, ?)').run(
        id,
        d.name,
        d.description,
        now
      );
      deptIds[d.name] = id;
    }
  }

  if (!config.security.seedDemoData) {
    return;
  }

  // Seed users only if no users exist yet
  const userCount = (db.prepare('SELECT COUNT(*) AS cnt FROM users').get() as { cnt: number }).cnt;
  if (userCount > 0) {
    return;
  }

  const demoPass = process.env.DEMO_SEED_PASSWORD || 'KnowledgeDemo!2026';
  const passwordHash = await bcrypt.hash(demoPass, 10);

  const roleMap = new Map<string, string>();
  for (const r of db.prepare('SELECT id, name FROM roles').all() as Array<{ id: string; name: string }>) {
    roleMap.set(r.name, r.id);
  }

  const adminId = uuidv4();
  const ownerId = uuidv4();
  const engEmployeeId = uuidv4();
  const hrEmployeeId = uuidv4();

  const users = [
    {
      id: adminId,
      email: 'admin@knowledgeassist.local',
      fullName: 'Maya Lin (Enterprise Admin)',
      roles: ['ADMIN', 'EMPLOYEE'],
      depts: ['Engineering', 'Security'],
    },
    {
      id: ownerId,
      email: 'owner.hr@knowledgeassist.local',
      fullName: 'Jordan Vance (Knowledge Owner)',
      roles: ['KNOWLEDGE_OWNER', 'EMPLOYEE'],
      depts: ['Human Resources'],
    },
    {
      id: engEmployeeId,
      email: 'alex.eng@knowledgeassist.local',
      fullName: 'Alex Rivera (Engineering)',
      roles: ['EMPLOYEE'],
      depts: ['Engineering'],
    },
    {
      id: hrEmployeeId,
      email: 'sam.finance@knowledgeassist.local',
      fullName: 'Sam Patel (Finance)',
      roles: ['EMPLOYEE'],
      depts: ['Finance & Legal'],
    },
  ];

  for (const u of users) {
    db.prepare(`
      INSERT INTO users (id, email, full_name, password_hash, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(u.id, u.email, u.fullName, passwordHash, now, now);

    for (const rName of u.roles) {
      const rId = roleMap.get(rName);
      if (rId) {
        db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(u.id, rId);
      }
    }
    for (const dName of u.depts) {
      const dId = deptIds[dName];
      if (dId) {
        db.prepare(
          'INSERT INTO department_members (department_id, user_id, assigned_at) VALUES (?, ?, ?)'
        ).run(dId, u.id, now);
      }
    }
  }

  const adminUser = loadAuthUserById(adminId)!;
  const hrOwner = loadAuthUserById(ownerId)!;

  // Seed 4 real enterprise documents through the genuine extraction -> chunking -> embedding pipeline
  const sampleDocs = [
    {
      name: 'Employee_Handbook_2026',
      filename: 'Employee_Handbook_2026.md',
      scope: 'ALL_EMPLOYEES' as const,
      departmentId: deptIds['Human Resources'],
      owner: hrOwner,
      allowedUserIds: [],
      content: `# KnowledgeAssist Corp Employee Handbook (2026 Edition)

## 1. Working Hours and Hybrid Policy
Standard full-time employees work 40 hours per week under a hybrid model. Core collaboration hours are 10:00 AM to 3:00 PM local time Tuesday through Thursday. Remote work days on Monday and Friday require Slack availability and calendar accuracy.

## 2. Paid Time Off and Parental Leave
Full-time employees accrue 22 days of Paid Time Off (PTO) annually, prorated monthly from the start date. Unused PTO up to 5 days may carry over into Q1 of the following year.
Primary and secondary caregivers are eligible for 16 weeks of 100% paid parental leave within 12 months of birth or adoption. Requests must be submitted in Workday at least 30 days prior to the expected leave date.

## 3. Notice Period and Offboarding
Standard resignation notice period for individual contributors is 2 weeks (14 calendar days). Senior Staff Engineers, Principals, and People Managers must provide 4 weeks (28 calendar days) notice.
If the notice period is not served without an approved written waiver from Human Resources, accrued unused PTO payout may be forfeited where permitted by local labor law, and rehire eligibility is marked as conditional. Notice period waivers require joint approval from the employee's VP and the VP of People Operations.

## 4. Travel and Meal Reimbursement
Daily meal allowance during approved domestic business travel is capped at $75 USD per day with itemized receipts. International travel meal allowance is $105 USD per day. Alcohol is not reimbursable under standard travel expenses.`,
    },
    {
      name: 'Engineering_Incident_Response_SOP',
      filename: 'Engineering_Incident_Response_SOP.md',
      scope: 'DEPARTMENT' as const,
      departmentId: deptIds['Engineering'],
      owner: adminUser,
      allowedUserIds: [],
      content: `# Engineering Incident Response Standard Operating Procedure

## 1. Severity Classification
SEV-1 (Critical): Complete production outage, data corruption, or verified security breach affecting >10% of active tenants. Initial acknowledgement SLA is 5 minutes; status updates every 15 minutes.
SEV-2 (High): Degraded primary workflow or regional latency spike >3x baseline with workaround available. Initial acknowledgement SLA is 15 minutes; updates every 30 minutes.
SEV-3 (Moderate): Non-critical internal tooling failure or isolated customer defect. Resolved during business hours within 24 hours.

## 2. Incident Command Roles
Every SEV-1 and SEV-2 incident requires an Incident Commander (IC), a Communications Lead, and a Technical Subject Matter Expert (SME). The IC owns timeline coordination and escalation decisions. Do not merge hotfix pull requests during a SEV-1 without explicit IC sign-off and rollback verification.

## 3. Post-Incident Review (Blameless Postmortem)
A blameless postmortem document must be drafted within 48 hours of incident resolution and reviewed in the weekly Thursday Reliability Guild. Every postmortem must include root cause analysis, detection gap evaluation, and at least two concrete remediation tickets with assigned owners and due dates.`,
    },
    {
      name: 'Finance_Procurement_Policy',
      filename: 'Finance_Procurement_Policy.txt',
      scope: 'DEPARTMENT' as const,
      departmentId: deptIds['Finance & Legal'],
      owner: adminUser,
      allowedUserIds: [],
      content: `FINANCE & PROCUREMENT APPROVAL POLICY (FIN-204)

1. SOFTWARE AND VENDOR SPEND THRESHOLDS
Purchases up to $2,500 USD may be approved by a Department Director.
Purchases between $2,501 and $25,000 USD require VP approval plus Finance FP&A budget verification.
Purchases exceeding $25,000 USD require CFO sign-off, formal Legal contract redline, and Security vendor risk assessment (SIG Lite).

2. CORPORATE CARD RECONCILIATION
All corporate card transactions must be reconciled with itemized PDF invoices by the 5th business day of the following month. Missing receipts over $25 require a signed Missing Receipt Affidavit.`,
    },
    {
      name: 'Executive_SOC2_Audit_Findings',
      filename: 'Executive_SOC2_Audit_Findings.md',
      scope: 'RESTRICTED' as const,
      departmentId: deptIds['Security'],
      owner: adminUser,
      allowedUserIds: [adminId],
      content: `# CONFIDENTIAL: FY2026 SOC 2 Type II Pre-Audit Findings

## 1. Key Rotation Remediation
Observation SEC-09: Legacy service accounts in eu-west-1 rotated KMS keys every 180 days instead of the mandatory 90-day policy. Remediation target date is November 30, 2026, owned by Cloud Security Lead.

## 2. Break-Glass Access Protocol
Production break-glass root tokens are stored in hardware-backed YubiKey vaults split across two executives. Every break-glass invocation triggers a mandatory PagerDuty SEV-1 security audit alert and requires dual-party sign-off within 4 hours.`,
    },
  ];

  for (const doc of sampleDocs) {
    await createUploadedDocument(
      {
        fileBuffer: Buffer.from(doc.content, 'utf8'),
        originalFilename: doc.filename,
        mimeType: doc.filename.endsWith('.md') ? 'text/markdown' : 'text/plain',
        documentName: doc.name,
        departmentId: doc.departmentId,
        accessScope: doc.scope,
        allowedUserIds: doc.allowedUserIds,
        owner: doc.owner,
      },
      { synchronousIngestion: true }
    );
  }
}
