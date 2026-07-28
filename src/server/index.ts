// Node / Docker 入口：@hono/node-server 起 HTTP server，serveStatic 托管前端 dist/，
// node-cron 进程内定时。密钥来自 process.env，数据库为本地 SQLite 文件。
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import cron from 'node-cron';
import type { AppSecrets } from '../shared/types.js';
import { createApp } from '../shared/routes.js';
import { createSqliteDb } from './db-sqlite.js';
import { runScheduledTick } from '../shared/scheduler.js';
import { runStartupMigration, type StartupDeps } from '../shared/startup.js';
import { runMigrations } from '../shared/migrate.js';
import { MIGRATIONS } from '../shared/migrations.js';
import { hashPassword } from '../shared/password.js';
import { createProxyFetch } from './proxy.js';

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

// 组合根：把迁移原语绑给 startup（startup 自身只留类型 import，见其顶部说明）。
const startupDeps: StartupDeps = { runMigrations, hashPassword, migrations: MIGRATIONS };

// 启动即跑迁移 + seed 首个 admin + 回填存量数据（幂等；见 multiuser-plan 第六节）。
// Node 有「服务未开始收请求」的时机，故在 serve() 之前 await 完成。
const boot = await runStartupMigration(db, secrets, startupDeps);
if (boot.seededAdmin) {
  console.log('已 seed 首个 admin（用户名 admin，初始密码取自 ADMIN_PASSWORD）。改密后该环境变量不再影响登录。');
}
if (boot.migrationsApplied.length) {
  console.log(`已应用迁移：${boot.migrationsApplied.join(', ')}`);
}

// Node 启动时已完成引导；仍注入 runStartup，使 /api/admin/bootstrap 幂等可用（两平台对称）。
const app = createApp({
  db,
  secrets,
  makeFetch: createProxyFetch,
  runStartup: (d, s) => runStartupMigration(d, s, startupDeps),
});

// 前端静态资源：非 /api/* 的请求交给 serveStatic，未命中回落 index.html（SPA）
const indexHtml = readFileSync(resolve(DIST_DIR, 'index.html'), 'utf-8');
app.use('/*', serveStatic({ root: DIST_DIR }));
app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ error: 'not found' }, 404);
  return c.html(indexHtml);
});

// 进程内定时：每 5 分钟触发，与 Workers cron 语义一致
cron.schedule('*/5 * * * *', () => {
  void runScheduledTick(db, secrets, Date.now(), createProxyFetch);
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`Rrelaynest server listening on http://0.0.0.0:${info.port}`);
});
