// Node / Docker 入口：@hono/node-server 起 HTTP server，serveStatic 托管前端 dist/，
// node-cron 进程内定时。密钥来自 process.env，数据库为本地 SQLite 文件。
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import cron from 'node-cron';
import type { AppSecrets } from '../shared/types';
import { createApp } from '../shared/routes';
import { createSqliteDb } from './db-sqlite';
import { runScheduledTick } from '../shared/scheduler';

const PORT = Number(process.env.PORT ?? '3100');
const DB_PATH = process.env.DB_PATH ?? resolve('data', 'rrelaynest.sqlite');
const DIST_DIR = process.env.DIST_DIR ?? 'dist';

function loadSecrets(): AppSecrets {
  const missing = ['ADMIN_PASSWORD', 'SESSION_SECRET', 'ENCRYPTION_KEY'].filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`缺少必需的环境变量：${missing.join(', ')}`);
  }
  return {
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD!,
    SESSION_SECRET: process.env.SESSION_SECRET!,
    ENCRYPTION_KEY: process.env.ENCRYPTION_KEY!,
  };
}

const secrets = loadSecrets();
const db = createSqliteDb(DB_PATH); // 构造时若库为空会自动执行 schema.sql
const app = createApp({ db, secrets });

// 前端静态资源：非 /api/* 的请求交给 serveStatic，未命中回落 index.html（SPA）
const indexHtml = readFileSync(resolve(DIST_DIR, 'index.html'), 'utf-8');
app.use('/*', serveStatic({ root: DIST_DIR }));
app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'not found' }, 404);
  return c.html(indexHtml);
});

// 进程内定时：每 5 分钟触发，与 Workers cron 语义一致
cron.schedule('*/5 * * * *', () => {
  void runScheduledTick(db, secrets, Date.now());
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Rrelaynest server listening on http://0.0.0.0:${info.port}`);
});
