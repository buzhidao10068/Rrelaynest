// 爬取/签到并落库的共享逻辑：手动（routes）与定时（cron）都调用这里。
// 平台无关：只依赖 shared/db 的 Database 抽象与 shared/scraper 的纯 fetch 逻辑。
// 代理注入走「依赖注入」：Node 入口传 makeFetch（按代理配置返回绑好 dispatcher 的 undici.fetch），
// Workers 不传（makeFetch=undefined → 用全局 fetch 恒直连），故本文件不 import 任何 Node 专属模块。
import type { Database } from './db.js';
import type { SiteRow, AppSecrets, ProxyRow, MakeFetch, FetchLike } from './types.js';
import { decryptToken } from './crypto.js';
import { scrapeSite, checkinSite } from './scraper.js';
import { retryAsync } from './concurrency.js';

// 单站爬取/签到的运行配置：超时 + 重试（并发在批量层控制，见 scrape-all / scheduler）。
// 来源为每用户 settings（scrape_timeout_sec / scrape_retry），由调用方读出后传入。
export interface ScrapeConfig {
  timeoutMs?: number; // 单次 HTTP 请求超时；<=0/未设为不限时
  retries?: number; // 失败重试次数（额外尝试）；<=0 只跑一次。仅爬取重试，签到不重试（避免重复签到）
}

// 每用户 settings 的爬取配置默认值（面板未设时用）。
const DEFAULT_TIMEOUT_SEC = 15;
const DEFAULT_RETRY = 1;
const DEFAULT_CONCURRENCY = 5;

// 从每用户 settings 读爬取配置。缺省时回落默认值；非法值被夹到安全范围。
export async function readScrapeConfig(
  db: Database,
  userId: number,
): Promise<{ config: ScrapeConfig; concurrency: number }> {
  const rows = await db
    .prepare(
      "SELECT key, value FROM settings WHERE user_id = ? AND key IN ('scrape_timeout_sec','scrape_retry','scrape_concurrency')",
    )
    .bind(userId)
    .all<{ key: string; value: string }>();
  const map: Record<string, string> = {};
  for (const r of rows.results) map[r.key] = r.value;

  const timeoutSec = clampNum(map.scrape_timeout_sec, DEFAULT_TIMEOUT_SEC, 1, 600);
  const retries = clampNum(map.scrape_retry, DEFAULT_RETRY, 0, 10);
  const concurrency = clampNum(map.scrape_concurrency, DEFAULT_CONCURRENCY, 1, 100);
  return { config: { timeoutMs: timeoutSec * 1000, retries }, concurrency };
}

function clampNum(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

// 解析某站点实际该走的代理，返回绑好代理的 fetch（未注入工厂/直连时为 undefined，scraper 回落全局 fetch）。
// 选取优先级（与前端一致）：站点自绑代理(enabled) > 全局代理(enabled) > 直连。
// 代理密码解密失败时降级为直连（不中断爬取，容错优先）。
async function resolveFetch(
  db: Database,
  secrets: AppSecrets,
  site: SiteRow,
  makeFetch?: MakeFetch,
): Promise<FetchLike | undefined> {
  if (!makeFetch) return undefined; // Workers：无工厂，用全局 fetch 恒直连

  // 站点绑定优先；未绑定则回落该用户的全局代理。
  // ⚠ settings 已是复合主键 (user_id, key)，全局代理按站点归属用户查（见 multiuser-plan 1.3）。
  let proxyId: number | null = site.proxy_id;
  if (proxyId == null) {
    const row = await db
      .prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'global_proxy_id'")
      .bind(site.user_id)
      .first<{ value: string }>();
    const gid = row?.value ? Number(row.value) : NaN;
    proxyId = Number.isFinite(gid) ? gid : null;
  }
  if (proxyId == null) return undefined; // 无绑定且无全局 → 直连

  // 代理也按归属用户查：即便 proxy_id 越界指向他人代理，也查不到 → 降级直连（隔离兜底）。
  const proxy = await db
    .prepare('SELECT * FROM proxies WHERE id = ? AND user_id = ?')
    .bind(proxyId, site.user_id)
    .first<ProxyRow>();
  if (!proxy || !proxy.enabled) return undefined; // 代理不存在/不属己/被禁用 → 直连

  let password: string | null = null;
  if (proxy.password_encrypted) {
    try {
      password = await decryptToken(secrets.ENCRYPTION_KEY, proxy.password_encrypted);
    } catch {
      return undefined; // 密码解密失败 → 降级直连，不中断爬取
    }
  }

  return makeFetch({
    type: proxy.type,
    host: proxy.host,
    port: proxy.port,
    username: proxy.username,
    password,
  });
}

export interface ScrapeOutcome {
  site_id: number;
  name: string;
  ok: boolean;
  balance?: number | null;
  groups?: number;
  models?: number;
  error?: string;
}

export interface CheckinOutcome {
  site_id: number;
  name: string;
  ok: boolean;
  result: string; // 写入 checkin_result 的人类可读消息
  needs_manual?: boolean; // Turnstile 等需手动签到的情况
}

// 解密站点 token；失败时写 last_error 并返回 null（调用方据此跳过）。
async function resolveToken(
  db: Database,
  secrets: AppSecrets,
  site: SiteRow,
  now: number,
  errorColumn: 'last_error' | 'checkin_result',
): Promise<string | null> {
  if (!site.token_encrypted) {
    const msg = '未配置 access token';
    await db
      .prepare(`UPDATE sites SET ${errorColumn} = ?, updated_at = ? WHERE id = ?`)
      .bind(msg, now, site.id)
      .run();
    return null;
  }
  try {
    return await decryptToken(secrets.ENCRYPTION_KEY, site.token_encrypted);
  } catch {
    const msg = 'token 解密失败（ENCRYPTION_KEY 可能已更换）';
    await db
      .prepare(`UPDATE sites SET ${errorColumn} = ?, updated_at = ? WHERE id = ?`)
      .bind(msg, now, site.id)
      .run();
    return null;
  }
}

export async function scrapeAndStore(
  db: Database,
  secrets: AppSecrets,
  site: SiteRow,
  makeFetch?: MakeFetch,
  config?: ScrapeConfig,
): Promise<ScrapeOutcome> {
  const now = Date.now();
  const token = await resolveToken(db, secrets, site, now, 'last_error');
  if (token === null) {
    return { site_id: site.id, name: site.name, ok: false, error: '未配置 access token 或解密失败' };
  }

  try {
    const fetchImpl = await resolveFetch(db, secrets, site, makeFetch);
    // 网络爬取按配置重试（DB 落库不在重试范围内）。签到不重试（见 checkinAndStore 注释）。
    const result = await retryAsync(
      () => scrapeSite(site.base_url, token, { fetchImpl, timeoutMs: config?.timeoutMs }),
      { retries: config?.retries ?? 0 },
    );

    // 事务批量替换该站点的分组与模型
    const stmts = [
      db.prepare('DELETE FROM site_groups WHERE site_id = ?').bind(site.id),
      db.prepare('DELETE FROM site_models WHERE site_id = ?').bind(site.id),
    ];
    for (const g of result.groups) {
      stmts.push(
        db
          .prepare(
            'INSERT INTO site_groups (site_id, group_name, group_ratio, group_desc, updated_at) VALUES (?, ?, ?, ?, ?)',
          )
          .bind(site.id, g.group_name, g.group_ratio, g.group_desc, now),
      );
    }
    for (const m of result.models) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO site_models
              (site_id, model_name, quota_type, model_ratio, completion_ratio, model_price, enable_groups, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            site.id,
            m.model_name,
            m.quota_type,
            m.model_ratio,
            m.completion_ratio,
            m.model_price,
            JSON.stringify(m.enable_groups),
            now,
          ),
      );
    }

    // 余额抓到才更新，抓不到保留旧值；无论如何清空 last_error 并记录时间
    if (result.balance !== null) {
      stmts.push(
        db
          .prepare('UPDATE sites SET balance = ?, last_scraped_at = ?, last_error = NULL, updated_at = ? WHERE id = ?')
          .bind(result.balance, now, now, site.id),
      );
    } else {
      stmts.push(
        db
          .prepare('UPDATE sites SET last_scraped_at = ?, last_error = NULL, updated_at = ? WHERE id = ?')
          .bind(now, now, site.id),
      );
    }

    await db.batch(stmts);
    return {
      site_id: site.id,
      name: site.name,
      ok: true,
      balance: result.balance,
      groups: result.groups.length,
      models: result.models.length,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .prepare('UPDATE sites SET last_error = ?, updated_at = ? WHERE id = ?')
      .bind(msg, now, site.id)
      .run();
    return { site_id: site.id, name: site.name, ok: false, error: msg };
  }
}

// 执行签到并落库。成功置 checkin_done=1；Turnstile 拦截标记 needs_manual，不作致命错。
export async function checkinAndStore(
  db: Database,
  secrets: AppSecrets,
  site: SiteRow,
  makeFetch?: MakeFetch,
  config?: ScrapeConfig,
): Promise<CheckinOutcome> {
  const now = Date.now();
  const token = await resolveToken(db, secrets, site, now, 'checkin_result');
  if (token === null) {
    return { site_id: site.id, name: site.name, ok: false, result: '未配置 access token 或解密失败' };
  }

  // 签到走与爬取相同的代理。只应用超时，不重试——签到非幂等，重试可能重复签到或触发风控。
  const fetchImpl = await resolveFetch(db, secrets, site, makeFetch);
  const outcome = await checkinSite(site.base_url, token, { fetchImpl, timeoutMs: config?.timeoutMs });

  if (outcome.ok) {
    await db
      .prepare(
        'UPDATE sites SET checkin_done = 1, last_checkin_at = ?, checkin_result = ?, updated_at = ? WHERE id = ?',
      )
      .bind(now, outcome.message, now, site.id)
      .run();
    return { site_id: site.id, name: site.name, ok: true, result: outcome.message };
  }

  // 失败：记录结果但不置 checkin_done，也不影响爬取
  await db
    .prepare('UPDATE sites SET last_checkin_at = ?, checkin_result = ?, updated_at = ? WHERE id = ?')
    .bind(now, outcome.message, now, site.id)
    .run();
  return {
    site_id: site.id,
    name: site.name,
    ok: false,
    result: outcome.message,
    needs_manual: outcome.needsManual,
  };
}
