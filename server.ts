import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server/app.js';
import { config } from './server/config.js';
import { getDb } from './server/db.js';
import { ensureSeedData } from './server/seed.js';

async function startServer(): Promise<void> {
  // Initialize SQLite database and seed enterprise baseline data
  getDb();
  await ensureSeedData();

  const app = createApp();

  if (config.isProd) {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'server_started',
        port: config.port,
        env: config.nodeEnv,
        llmProvider: config.gemini.apiKey
          ? config.gemini.chatModel
          : 'deterministic-extractive-fallback-v1',
      })
    );
  });
}

startServer().catch((err) => {
  console.error('Failed to start KnowledgeAssist server:', err);
  process.exit(1);
});
