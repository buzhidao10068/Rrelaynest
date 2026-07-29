// 定时任务的平台无关逻辑：按 scrape_interval_min 节流爬取 + 跨天重置签到 + 自动签到。
// Workers 的 scheduled() 和 Node 的 node-cron 都调用 runScheduledTick。
//
// 多用户改造（见 multiuser-plan 第五节）：settings 每用户化后，节流也每用户化。
// runScheduledTick 先取所有未停用用户，逐用户按「其」scrape_interval_min / last_cron_run_at
// 节流、只爬「其」站点；跨天重置只清「其」站点的 checkin_done。停用用户不参与定时（见 8.5-28）。
import type { Database, AppSecrets, SiteRow, MakeFetch } from './types.js';
import { scrapeAndStore, checkinAndStore, readScrapeConfig } from './scrape-runner.js';
import { mapWithConcurrency } from './concurrency.js';

// 跨天判定的默认时区：与前端 settings 默认值一致（避免 Workers UTC 与 Docker 本地时区漂移）。
// 每用户可覆盖为 IANA 名（settings.reset_timezone，如 'America/New_York'）。
const DEFAULT_TZ = 'Asia/Shanghai';

// 返回该时间戳在指定 IANA 时区下的日期字符串（YYYY-MM-DD）。用作跨天判定键。
// 无效 tz（如用户手误）静默回落到默认时区，避免调度器为一个坏配置整体崩掉。
function dayString(ts: number, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ts));
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: DEFAULT_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ts));
  }
}

// 每用户设置读写：复合主键 (user_id, key)（见 multiuser-plan 1.3）。
async function getSetting(db: Database, userId: number, key: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?')
    .bind(userId, key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

async function setSetting(db: Database, userId: number, key: string, value: string): Promise<void> {
  await db
    .prepare(
      'INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = ?',
    )
    .bind(userId, key, value, value)
    .run();
}

// 跨天则把「该用户」名下站点的 checkin_done 归零，供当天重新自动签到。
// 时区取该用户 settings.reset_timezone，缺省 Asia/Shanghai（与前端默认一致）。
async function maybeResetCheckin(db: Database, userId: number, now: number): Promise<void> {
  const tz = (await getSetting(db, userId, 'reset_timezone')) ?? DEFAULT_TZ;
  const lastReset = Number((await getSetting(db, userId, 'checkin_last_reset_at')) ?? '0');
  if (dayString(now, tz) === dayString(lastReset, tz)) return;
  await db
    .prepare('UPDATE sites SET checkin_done = 0 WHERE user_id = ? AND checkin_done = 1')
    .bind(userId)
    .run();
  await setSetting(db, userId, 'checkin_last_reset_at', String(now));
}

// 单个用户的一轮 tick：跨天重置 → 节流爬取 → 自动补签。全部只碰「该用户」的数据与设置。
async function runUserTick(
  db: Database,
  secrets: AppSecrets,
  userId: number,
  now: number,
  makeFetch?: MakeFetch,
): Promise<void> {
  // 1) 跨天重置签到标记（只清该用户的站）
  await maybeResetCheckin(db, userId, now);

  // 2) 按该用户设定的间隔节流爬取
  const intervalMin = Math.max(1, Number((await getSetting(db, userId, 'scrape_interval_min')) ?? '30'));
  const lastRun = Number((await getSetting(db, userId, 'last_cron_run_at')) ?? '0');
  const due = now - lastRun >= intervalMin * 60 * 1000;
  // 定时爬取总开关（前端「启用定时爬取」）：缺省视为开启，保持既有行为；'0' 时跳过爬取分支。
  // 只 gate 爬取，不影响自动签到（那是每站 checkin_enabled 决定的独立开关）。
  const autoOn = (await getSetting(db, userId, 'scrape_auto_enabled')) !== '0';

  // 该用户的爬取配置（并发/超时/重试），爬取与签到共用（见 [[scraper-backend-concurrency-todo]]）。
  const { config, concurrency } = await readScrapeConfig(db, userId);

  if (autoOn && due) {
    // 先占位时间戳，避免多次触发叠加
    await setSetting(db, userId, 'last_cron_run_at', String(now));
    const sites = await db.prepare('SELECT * FROM sites WHERE user_id = ?').bind(userId).all<SiteRow>();
    // scrapeAndStore 自身吞异常返回 outcome，mapper 不抛 → 可安全用受限并发。
    await mapWithConcurrency(sites.results, concurrency, (site) =>
      scrapeAndStore(db, secrets, site, makeFetch, config),
    );
  }

  // 3) 自动签到：仅对该用户已开启且今日未签的站（独立于爬取节流，每次 tick 都尝试补签）
  const pending = await db
    .prepare('SELECT * FROM sites WHERE user_id = ? AND checkin_enabled = 1 AND checkin_done = 0')
    .bind(userId)
    .all<SiteRow>();
  await mapWithConcurrency(pending.results, concurrency, (site) =>
    checkinAndStore(db, secrets, site, makeFetch, config),
  );
}

export async function runScheduledTick(
  db: Database,
  secrets: AppSecrets,
  now: number,
  makeFetch?: MakeFetch,
): Promise<void> {
  // 停用用户不参与定时（见 8.5-28）。逐用户串行——node:sqlite 单文件锁下本就串行，
  // 规模大时随 SCALING NOTE 升级（关联 [[scraper-backend-concurrency-todo]]）。
  const users = await db
    .prepare('SELECT id FROM users WHERE disabled = 0 ORDER BY id ASC')
    .all<{ id: number }>();
  for (const u of users.results) {
    await runUserTick(db, secrets, u.id, now, makeFetch);
  }
}
