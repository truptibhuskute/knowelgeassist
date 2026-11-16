import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from '../server/config.js';
import { getDb, resetDbForTests } from '../server/db.js';
import { ABSTENTION_MESSAGE } from '../server/llm/llmProvider.js';
import { executeRagChat } from '../server/rag/ragOrchestrator.js';
import { loadAuthUserById } from '../server/security/authService.js';
import { ensureSeedData } from '../server/seed.js';

interface EvalCase {
  id: number;
  userRole: string;
  question: string;
  expectedDoc: string | null;
  expectedKeyword: string | null;
  shouldAbstain: boolean;
  securityBoundary?: boolean;
}

async function main(): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ka-eval-'));
  config.uploadDir = path.join(tmpDir, 'uploads');
  resetDbForTests();
  const db = getDb(path.join(tmpDir, 'eval.db'));
  await ensureSeedData();

  const datasetPath = path.resolve(process.cwd(), 'scripts/evaluation_dataset.json');
  const cases = JSON.parse(fs.readFileSync(datasetPath, 'utf8')) as EvalCase[];

  let answerableCount = 0;
  let retrievalHitCount = 0;
  let citationCorrectCount = 0;
  let faithfulKeywordCount = 0;

  let abstentionExpectedCount = 0;
  let abstentionCorrectCount = 0;

  let securityExpectedCount = 0;
  let securityPreventedCount = 0;

  const latencies: number[] = [];

  for (const item of cases) {
    const uRow = db.prepare('SELECT id FROM users WHERE email = ?').get(item.userRole) as { id: string };
    const user = loadAuthUserById(uRow.id)!;

    const result = await executeRagChat({ user, question: item.question });
    latencies.push(result.retrievalMetadata.totalLatencyMs);

    if (item.shouldAbstain) {
      abstentionExpectedCount += 1;
      const didAbstain =
        result.retrievalMetadata.abstained && result.answer === ABSTENTION_MESSAGE;
      if (didAbstain) abstentionCorrectCount += 1;
      if (item.securityBoundary) {
        securityExpectedCount += 1;
        if (didAbstain && result.citations.length === 0) {
          securityPreventedCount += 1;
        }
      }
    } else {
      answerableCount += 1;
      const citedDocs = result.citations.map((c) => c.documentName);
      if (item.expectedDoc && citedDocs.includes(item.expectedDoc)) {
        retrievalHitCount += 1;
        citationCorrectCount += 1;
      }
      if (
        !result.retrievalMetadata.abstained &&
        item.expectedKeyword &&
        result.answer.toLowerCase().includes(item.expectedKeyword.toLowerCase())
      ) {
        faithfulKeywordCount += 1;
      }
    }
  }

  const avgLatency = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const p95Latency = [...latencies].sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];

  const report = {
    totalCases: cases.length,
    answerableCases: answerableCount,
    retrievalHitRateAt5: Number((retrievalHitCount / answerableCount).toFixed(4)),
    recallAt5: Number((retrievalHitCount / answerableCount).toFixed(4)),
    citationCorrectness: Number((citationCorrectCount / answerableCount).toFixed(4)),
    answerKeywordFaithfulness: Number((faithfulKeywordCount / answerableCount).toFixed(4)),
    abstentionExpectedCases: abstentionExpectedCount,
    correctAbstentionRate: Number((abstentionCorrectCount / abstentionExpectedCount).toFixed(4)),
    unauthorizedPreventionRate: Number((securityPreventedCount / securityExpectedCount).toFixed(4)),
    avgLatencyMs: avgLatency,
    p95LatencyMs: p95Latency,
    llmProvider: config.gemini.apiKey ? config.gemini.chatModel : 'deterministic-extractive-fallback-v1',
  };

  console.log(JSON.stringify(report, null, 2));
  resetDbForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
