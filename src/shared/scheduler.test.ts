// 定时任务隔离测试：覆盖 multiuser-plan 8.5（每用户节流 / 跨天重置 / 停用用户不参与）。
// 直接调 runScheduledTick（不经 app），用内存 SQLite + 无 token 站点作观测点：
//   无 token 的站点被爬取时，scrapeAndStore 在 resolveToken 处短路，写 last_error='未配置 access token'
//   且不发任何网络请求——于是「last_error 是否被写」即「该站是否被 tick 触碰」的干净信号。
import { test, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Database, PreparedStatement, AppSecrets } from './types.js';
import { runScheduledTick } from './scheduler.js';
import { runStartupMigration } from './startup.js';
import { runMigrations } from './migrate.js';
import { MIGRATIONS } from './migrations.js';
import { hashPassword } from './password.js';

function normalize(values: unknown[]): unknown[] {
  return values.map((v) => {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    return v;
  });
}

function memDb(): { db: Database; raw: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  function makeStmt(sql: string, bound: unknown[] = []): PreparedStatement {
    return {
      bind(...values: unknown[]) {
        return makeStmt(sql, values);
      },
      async first<T = Record<string, unknown>>() {
        return (sqlite.prepare(sql).get(...(normalize(bound) as never[])) as T) ?? null;
      },
      async all<T = Record<string, unknown>>() {
        return { results: sqlite.prepare(sql).all(...(normalize(bound) as never[])) as T[] };
      },
      async run() {
        const info = sqlite.prepare(sql).run(...(normalize(bound) as never[]));
        return { meta: { last_row_id: Number(info.lastInsertRowid) } };
      },
      _sql: sql,
      _bound: bound,
    } as PreparedStatement & { _sql: string; _bound: unknown[] };
  }
  const db: Database = {
    prepare(sql: string) {
      return makeStmt(sql);
    },
    async batch(statements: PreparedStatement[]) {
      sqlite.exec('BEGIN');
      try {
        for (const s of statements) {
          const { _sql, _bound } = s as PreparedStatement & { _sql: string; _bound: unknown[] };
          sqlite.prepare(_sql).run(...(normalize(_bound) as never[]));
        }
        sqlite.exec('COMMIT');
      } catch (err) {
        sqlite.exec('ROLLBACK');
        throw err;
      }
      return [];
    },
  };
  return { db, raw: sqlite };
}

const SECRETS: AppSecrets = {
  ADMIN_PASSWORD: 'admin-init-pw',
  SESSION_SECRET: 'test-session-secret',
  ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32))),
};

const DEPS = { runMigrations, hashPassword, migrations: MIGRATIONS };

const DAY_MS = 24 * 60 * 60 * 1000;

// 迁移 + seed admin，再插两个普通用户 A/B，返回其 id。
async function setup(): Promise<{ raw: DatabaseSync; db: Database; aId: number; bId: number }> {
  const { db, raw } = memDb();
  await runStartupMigration(db, SECRETS, DEPS);
  const now = Date.now();
  const hash = await hashPassword('pw');
  const ids: Record<string, number> = {};
  for (const name of ['userA', 'userB']) {
    const info = raw
      .prepare(
        `INSERT INTO users (username, password_hash, role, disabled, session_version, created_at, updated_at)
         VALUES (?, ?, 'user', 0, 1, ?, ?)`,
      )
      .run(name, hash, now, now);
    ids[name] = Number(info.lastInsertRowid);
  }
  return { raw, db, aId: ids.userA, bId: ids.userB };
}

// 插一个无 token 的站点（爬取时会短路写 last_error，不发网络请求）。
function insertSite(
  raw: DatabaseSync,
  userId: number,
  name: string,
  opts: { checkin_enabled?: number; checkin_done?: number } = {},
): number {
  const now = Date.now();
  const info = raw
    .prepare(
      `INSERT INTO sites (user_id, name, base_url, currency, checkin_enabled, checkin_done, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, 'USD', ?, ?, 0, ?, ?)`,
    )
    .run(userId, name, `https://${name}.example.com`, opts.checkin_enabled ?? 0, opts.checkin_done ?? 0, now, now);
  return Number(info.lastInsertRowid);
}

function setSetting(raw: DatabaseSync, userId: number, key: string, value: string): void {
  raw
    .prepare(
      'INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = ?',
    )
    .run(userId, key, value, value);
}

function lastError(raw: DatabaseSync, siteId: number): string | null {
  return (raw.prepare('SELECT last_error FROM sites WHERE id = ?').get(siteId) as { last_error: string | null })
    .last_error;
}

function checkinDone(raw: DatabaseSync, siteId: number): number {
  return (raw.prepare('SELECT checkin_done FROM sites WHERE id = ?').get(siteId) as { checkin_done: number })
    .checkin_done;
}

// ==== 8.5 定时任务隔离 ====

test('8.5-26 A 间隔到点、B 未到点：只有 A 的站被爬', async () => {
  const { raw, db, aId, bId } = await setup();
  const sA = insertSite(raw, aId, 'a-site');
  const sB = insertSite(raw, bId, 'b-site');
  const now = Date.now();
  // A 到点（last_run=0 → 距今远超间隔）；B 刚跑过（last_run=now → 未到点）。间隔都用默认 30。
  setSetting(raw, aId, 'last_cron_run_at', '0');
  setSetting(raw, bId, 'last_cron_run_at', String(now));

  await runScheduledTick(db, SECRETS, now);

  // A 的站被爬（无 token → 写 last_error）；B 的站未被爬（last_error 仍 NULL）。
  expect(lastError(raw, sA)).toBe('未配置 access token');
  expect(lastError(raw, sB)).toBeNull();
});

test('定时爬取总开关 scrape_auto_enabled=0：到点也不爬，但自动签到照常', async () => {
  const { raw, db, aId } = await setup();
  // 一个开了自动签到、今日未签的站；到点（last_run=0）。关掉爬取总开关。
  const sA = insertSite(raw, aId, 'a-site', { checkin_enabled: 1, checkin_done: 0 });
  const now = Date.now();
  setSetting(raw, aId, 'last_cron_run_at', '0');
  setSetting(raw, aId, 'scrape_auto_enabled', '0');

  await runScheduledTick(db, SECRETS, now);

  // 爬取被跳过：无 token 的站若被爬会写 last_error，这里仍为 NULL。
  expect(lastError(raw, sA)).toBeNull();
  // 自动签到不受总开关影响：checkin_result 被写（无 token → 写失败原因）。
  const checkin = (raw.prepare('SELECT checkin_result FROM sites WHERE id = ?').get(sA) as {
    checkin_result: string | null;
  }).checkin_result;
  expect(checkin).not.toBeNull();
});

test('8.5-27 跨天重置只清对应用户的 checkin_done', async () => {
  const { raw, db, aId, bId } = await setup();
  // 两站都 checkin_done=1、checkin_enabled=0（关掉自动签到，隔离观察重置本身）。
  const sA = insertSite(raw, aId, 'a-site', { checkin_enabled: 0, checkin_done: 1 });
  const sB = insertSite(raw, bId, 'b-site', { checkin_enabled: 0, checkin_done: 1 });
  const now = Date.now();
  // A 的上次重置在「昨天」→ 跨天，应重置；B 的在「今天」→ 不重置。
  setSetting(raw, aId, 'checkin_last_reset_at', String(now - DAY_MS));
  setSetting(raw, bId, 'checkin_last_reset_at', String(now));
  // 两者都刚跑过，避免爬取分支干扰（本用例只看重置）。
  setSetting(raw, aId, 'last_cron_run_at', String(now));
  setSetting(raw, bId, 'last_cron_run_at', String(now));

  await runScheduledTick(db, SECRETS, now);

  expect(checkinDone(raw, sA)).toBe(0); // A 被重置
  expect(checkinDone(raw, sB)).toBe(1); // B 未被重置
});

test('跨天重置感知 reset_timezone：同一 UTC 时刻，Shanghai 用户跨天而 NY 用户未跨', async () => {
  const { raw, db, aId, bId } = await setup();
  // A=Shanghai(UTC+8) / B=New_York(EST UTC-5)。now=2025-01-01 22:00Z。
  //   Shanghai: 2025-01-02 06:00 → 日=2025-01-02
  //   NY: 2025-01-01 17:00 → 日=2025-01-01
  // 上次重置 = now-12h = 2025-01-01 10:00Z。
  //   Shanghai 上次=2025-01-01 18:00(日 01-01) ≠ 现在(日 01-02) → 应重置。
  //   NY 上次=2025-01-01 05:00(日 01-01) == 现在(日 01-01) → 不重置。
  const now = Date.UTC(2025, 0, 1, 22, 0, 0);
  const lastReset = now - 12 * 60 * 60 * 1000;
  const sA = insertSite(raw, aId, 'a-site', { checkin_enabled: 0, checkin_done: 1 });
  const sB = insertSite(raw, bId, 'b-site', { checkin_enabled: 0, checkin_done: 1 });
  setSetting(raw, aId, 'reset_timezone', 'Asia/Shanghai');
  setSetting(raw, bId, 'reset_timezone', 'America/New_York');
  setSetting(raw, aId, 'checkin_last_reset_at', String(lastReset));
  setSetting(raw, bId, 'checkin_last_reset_at', String(lastReset));
  // 都刚跑过，隔离爬取分支只看重置。
  setSetting(raw, aId, 'last_cron_run_at', String(now));
  setSetting(raw, bId, 'last_cron_run_at', String(now));

  await runScheduledTick(db, SECRETS, now);

  expect(checkinDone(raw, sA)).toBe(0); // Shanghai 跨天 → 重置
  expect(checkinDone(raw, sB)).toBe(1); // NY 未跨天 → 保留
});

test('无效时区静默回落默认(Asia/Shanghai)：不因坏配置崩溃', async () => {
  const { raw, db, aId } = await setup();
  const sA = insertSite(raw, aId, 'a-site', { checkin_enabled: 0, checkin_done: 1 });
  const now = Date.UTC(2025, 0, 1, 22, 0, 0); // Shanghai: 01-02 06:00
  const lastReset = now - 12 * 60 * 60 * 1000; // Shanghai: 01-01 18:00
  setSetting(raw, aId, 'reset_timezone', 'Not/A_Real_TZ');
  setSetting(raw, aId, 'checkin_last_reset_at', String(lastReset));
  setSetting(raw, aId, 'last_cron_run_at', String(now));

  await runScheduledTick(db, SECRETS, now);

  // 回落到 Shanghai → 跨天 → 应重置。
  expect(checkinDone(raw, sA)).toBe(0);
});

test('8.5-28 停用用户不参与定时：不爬其站、不签其到', async () => {
  const { raw, db, aId, bId } = await setup();
  // B 停用；两用户都「到点」。
  raw.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(bId);
  const sA = insertSite(raw, aId, 'a-site', { checkin_enabled: 1, checkin_done: 0 });
  const sB = insertSite(raw, bId, 'b-site', { checkin_enabled: 1, checkin_done: 0 });
  const now = Date.now();
  setSetting(raw, aId, 'last_cron_run_at', '0');
  setSetting(raw, bId, 'last_cron_run_at', '0');

  await runScheduledTick(db, SECRETS, now);

  // A 被爬；B 被跳过（last_error 仍 NULL）。
  expect(lastError(raw, sA)).toBe('未配置 access token');
  expect(lastError(raw, sB)).toBeNull();
  // B 的 checkin_result 也没被写（未参与自动签到）。
  const bCheckin = (raw.prepare('SELECT checkin_result FROM sites WHERE id = ?').get(sB) as {
    checkin_result: string | null;
  }).checkin_result;
  expect(bCheckin).toBeNull();
});
