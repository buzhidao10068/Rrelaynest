// Cloudflare Workers 入口：fetch 处理 API + 静态资源，scheduled 处理 Cron 定时任务。
// D1 与 ASSETS 由平台绑定注入；密钥来自 wrangler secret。
import type { AppSecrets } from '../shared/types.js';
import { createApp } from '../shared/routes.js';
import { wrapD1 } from './db-d1.js';
import { runScheduledTick } from '../shared/scheduler.js';
import { runStartupMigration, type StartupDeps } from '../shared/startup.js';
import { runMigrations } from '../shared/migrate.js';
import { MIGRATIONS } from '../shared/migrations.js';
import { hashPassword } from '../shared/password.js';
// 版本从 package.json 构建期内联（Workers 无文件系统，靠 esbuild/wrangler 打包 JSON import）。
import pkg from '../../package.json';

const APP_VERSION = (pkg as { version?: string }).version ?? '0.0.0';

// 组合根：把迁移原语绑给 startup（startup 自身只留类型 import，见其顶部说明）。
// Workers 无启动钩子，故不在此处 await；引导有两条触发路径（幂等，互不冲突）：
//   1) 首个 /api/* 请求自动触发（下方 ensureBootstrap，供 Deploy 按钮等无法回调端点的部署）；
//   2) POST /api/admin/bootstrap 显式触发（保留兼容，令牌校验，见 routes.ts）。
const startupDeps: StartupDeps = { runMigrations, hashPassword, migrations: MIGRATIONS };

// 首访自动引导：同一 isolate 内只跑一次，后续请求复用已完成的 promise（零 DB 开销）。
// runStartupMigration 本身完全幂等（迁移查 schema_migrations 跳过、seed 仅当 users 空、
// 回填只认 NULL），故即使多 isolate 或并发首请求同时触发，最坏是重复几次幂等操作，不损坏数据。
// 失败不缓存（置回 null）——避免一次瞬时 DB 抖动把该 isolate 永久卡在未引导态；下个请求会重试。
let bootstrapPromise: Promise<unknown> | null = null;
function ensureBootstrap(db: ReturnType<typeof wrapD1>, secrets: AppSecrets): Promise<unknown> {
  if (!bootstrapPromise) {
    bootstrapPromise = runStartupMigration(db, secrets, startupDeps).catch((err) => {
      bootstrapPromise = null; // 失败不缓存，下次重试
      throw err;
    });
  }
  return bootstrapPromise;
}

interface WorkerEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  ENCRYPTION_KEY: string;
}

function secretsOf(env: WorkerEnv): AppSecrets {
  return {
    ADMIN_PASSWORD: env.ADMIN_PASSWORD,
    SESSION_SECRET: env.SESSION_SECRET,
    ENCRYPTION_KEY: env.ENCRYPTION_KEY,
  };
}

export default {
  // HTTP：/api/* 交给 Hono，其余回落到前端静态资源（SPA）
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      const db = wrapD1(env.DB);
      const secrets = secretsOf(env);
      // 首访自动引导：建表 + seed 首个 admin（幂等）。await 确保表就绪后再处理请求，
      // 这样 Deploy 按钮等无法在部署后回调 HTTP 端点的路径也能零手动完成初始化。
      // 引导失败（如密钥缺失/DB 不可用）不吞：让请求照常走下去返回其真实错误，便于排查。
      try {
        await ensureBootstrap(db, secrets);
      } catch (err) {
        console.error('首访自动引导失败（将继续处理请求）：', err);
      }
      const app = createApp({
        db,
        secrets,
        runStartup: (d, s) => runStartupMigration(d, s, startupDeps),
        appVersion: APP_VERSION,
        platform: 'workers',
      });
      return app.fetch(request, env, ctx);
    }
    // 静态资源由 [assets] 绑定处理，未命中回落 index.html（见 wrangler.toml）
    return env.ASSETS.fetch(request);
  },

  // Cron：每 5 分钟触发；实际是否爬取/签到由面板设定的间隔与跨天判断决定
  async scheduled(_event: ScheduledController, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduledTick(wrapD1(env.DB), secretsOf(env), Date.now()));
  },
};
