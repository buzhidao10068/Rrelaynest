// 定时任务的平台无关逻辑：按 scrape_interval_min 节流爬取 + 跨天重置签到 + 自动签到。
// Workers 的 scheduled() 和 Node 的 node-cron 都调用 runScheduledTick。
import type { Database, AppSecrets, SiteRow } from './types';
import { scrapeAndStore, checkinAndStore } from './scrape-runner';

// 日界固定用 UTC+8，避免 Workers(UTC) 与 Docker(本地时区) 的跨天判定不一致。
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

function dayIndex(ts: number): number {
  return Math.floor((ts + TZ_OFFSET_MS) / (24 * 60 * 60 * 1000));
}

async function getSetting(db: Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function setSetting(db: Database, key: string, value: string): Promise<void> {
  await db
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?')
    .bind(key, value, value)
    .run();
}

// 跨天则把所有站的 checkin_done 归零，供当天重新自动签到。
async function maybeResetCheckin(db: Database, now: number): Promise<void> {
  const lastReset = Number((await getSetting(db, 'checkin_last_reset_at')) ?? '0');
  if (dayIndex(now) === dayIndex(lastReset)) return;
  await db.prepare('UPDATE sites SET checkin_done = 0 WHERE checkin_done = 1').run();
  await setSetting(db, 'checkin_last_reset_at', String(now));
}

export async function runScheduledTick(db: Database, secrets: AppSecrets, now: number): Promise<void> {
  // 1) 跨天重置签到标记
  await maybeResetCheckin(db, now);

  // 2) 按面板设定的间隔节流爬取
  const intervalMin = Math.max(1, Number((await getSetting(db, 'scrape_interval_min')) ?? '30'));
  const lastRun = Number((await getSetting(db, 'last_cron_run_at')) ?? '0');
  const due = now - lastRun >= intervalMin * 60 * 1000;

  if (due) {
    // 先占位时间戳，避免多次触发叠加
    await setSetting(db, 'last_cron_run_at', String(now));
    const sites = await db.prepare('SELECT * FROM sites').all<SiteRow>();
    for (const site of sites.results) {
      await scrapeAndStore(db, secrets, site);
    }
  }

  // 3) 自动签到：仅对已开启且今日未签的站（独立于爬取节流，每次 tick 都尝试补签）
  const pending = await db
    .prepare('SELECT * FROM sites WHERE checkin_enabled = 1 AND checkin_done = 0')
    .all<SiteRow>();
  for (const site of pending.results) {
    await checkinAndStore(db, secrets, site);
  }
}
