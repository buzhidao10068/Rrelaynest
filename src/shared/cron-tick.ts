// 外部 Cron 触发端点：把 scheduled() 做的事暴露成一个带密钥的 HTTP 路由。
//
// 为什么需要它：Cloudflare 的 Cron Trigger 是【账号级】配额（免费版 5 个），而生产环境
// 没有任何 HTTP 方式能触发 scheduled()（/cdn-cgi/local/scheduled 仅本地 dev 有效）。
// 于是把本项目的 cron slot 让出去，改由一个中枢 Worker（cron-hub）持有唯一的 Cron Trigger，
// 到点用公网 fetch() POST 本路由。走公网而非 service binding 是刻意的：公网请求让本 Worker
// 拿到一次独立的顶层 invocation（各自一份新的 CPU 预算），service binding 则会共享中枢的预算。
//
// 与 scheduled() 的关系：两者调用同一个 runScheduledTick，行为完全一致，只是触发源不同。
// 因此本文件【不】包含任何业务判断——是否真的爬取/签到，仍由面板设定的间隔与跨天逻辑决定。
import { timingSafeEqual } from './auth.js';

// 中枢与本 Worker 约定的路径与请求头。改这里要同步改 cron-hub 的 TARGETS。
export const CRON_TICK_PATH = '/internal/tick';
export const CRON_TICK_HEADER = 'X-Cron-Secret';

export interface CronTickDeps {
  /** 共享密钥，来自 env.CRON_SECRET；未配置时本路由直接拒绝服务（见下） */
  secret: string | undefined;
  /** 实际的 tick 工作，通常是 () => runScheduledTick(...) */
  run: () => Promise<void>;
  /** Workers 的 ctx.waitUntil；给了就后台跑并立即回 202，没给则等它跑完 */
  waitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * 处理一次外部 cron 触发。
 *
 * 只接受 POST：GET 是可被浏览器/爬虫无意触发的方法，定时任务这种有副作用的入口不该挂在上面。
 * 密钥缺失返回 503 而非 403——这是本端配置错误，不是调用方的错，中枢的日志里要能区分二者。
 */
export async function handleCronTick(request: Request, deps: CronTickDeps): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('method not allowed\n', { status: 405, headers: { Allow: 'POST' } });
  }

  if (!deps.secret) {
    console.error('[配置错误] CRON_SECRET 未设置，拒绝外部 cron 触发（wrangler secret put CRON_SECRET）');
    return new Response('cron trigger not configured\n', { status: 503 });
  }

  const got = request.headers.get(CRON_TICK_HEADER);
  if (got === null || !timingSafeEqual(got, deps.secret)) {
    return new Response('forbidden\n', { status: 403 });
  }

  // 失败只记日志、不改响应码：中枢已经拿到 202 了，重跑要等下一个 tick（任务本身幂等）。
  // 这里必须自己 catch —— 交给 waitUntil 的 promise 若被拒绝，只会变成一条无上下文的运行时报错。
  const work = deps.run().catch((err: unknown) => {
    console.error('外部 cron 触发的定时任务失败：', err);
  });

  if (deps.waitUntil) {
    deps.waitUntil(work);
  } else {
    await work;
  }
  return new Response('accepted\n', { status: 202 });
}
