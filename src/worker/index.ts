// Cloudflare Workers 入口：fetch 处理 API + 静态资源，scheduled 处理 Cron 定时任务。
// D1 与 ASSETS 由平台绑定注入；密钥来自 wrangler secret。
import type { AppSecrets } from '../shared/types';
import { createApp } from '../shared/routes';
import { wrapD1 } from './db-d1';
import { runScheduledTick } from '../shared/scheduler';

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
      const app = createApp({ db: wrapD1(env.DB), secrets: secretsOf(env) });
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
