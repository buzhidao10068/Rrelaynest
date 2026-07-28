// 启动迁移：两平台收敛于此。Node 进程启动时 await 调用；Workers 无启动钩子，
// 由 POST /api/admin/bootstrap 首访触发（见 multiuser-plan 第六节）。
// 全程幂等——迁移跳过已应用、seed 仅在 users 空时、回填仅认 NULL 存量，可反复安全调用。
//
// 顺序不可乱（见 multiuser-plan 1.5）：
//   1) 跑 DDL 迁移（建 users / 加 user_id / 重建 settings 为 (user_id,key)）。
//   2) seed 默认 admin：用 ADMIN_PASSWORD 的 PBKDF2 哈希（纯 SQL 算不了哈希，故在此代码里做）。
//   3) 拿到默认 admin id 后，回填存量 sites/proxies 的 user_id。
//   4) 把 0002 迁移暂存在 user_id=0 的「每用户」设置键迁到默认 admin。
// 2 必须先于 3/4，因为 3/4 要 admin 的 id。
//
// 依赖注入：runMigrations / hashPassword / migrations 由组合根（入口）绑定后传入
// （仅保留类型 import）。原因见 migrate.ts 顶部——Node 原生 TS 测试跑器无法解析
// 省略扩展名的「值」import，注入让本模块可被隔离单测（8.6-29/30）。

import type { AppSecrets, Database } from './types.js';
import type { Migration } from './migrations.js';
import type { MigrateResult } from './migrate.js';

// 属于「每用户」的设置键（0002 迁移把旧全局值暂存到 user_id=0，这里迁给默认 admin）。
// 未来的系统级键（如全局更新检查开关）不在此列，保留在 user_id=0。
const PER_USER_SETTING_KEYS = [
  'scrape_interval_min',
  'last_cron_run_at',
  'checkin_last_reset_at',
  'global_proxy_id',
];

// 注入的迁移原语（由入口绑定 shared/migrate.ts + shared/password.ts 后传入）。
export interface StartupDeps {
  runMigrations: (db: Database, migrations: Migration[], now?: number) => Promise<MigrateResult>;
  hashPassword: (plain: string) => Promise<string>;
  migrations: Migration[];
}

export interface StartupResult {
  migrationsApplied: string[]; // 本次真正执行的迁移 version
  seededAdmin: boolean; // 本次是否 seed 了默认 admin
  backfilledSites: number; // 本次回填 user_id 的存量站点数
  backfilledProxies: number; // 本次回填 user_id 的存量代理数
}

export async function runStartupMigration(
  db: Database,
  secrets: AppSecrets,
  deps: StartupDeps,
  now: number = Date.now(),
): Promise<StartupResult> {
  // 1) DDL 迁移（幂等）。
  const { applied } = await deps.runMigrations(db, deps.migrations, now);

  // 2) seed 默认 admin —— 仅当 users 表为空。username UNIQUE + INSERT OR IGNORE 双重兜底幂等。
  let seededAdmin = false;
  const anyUser = await db.prepare('SELECT id FROM users LIMIT 1').first<{ id: number }>();
  if (!anyUser) {
    const hash = await deps.hashPassword(secrets.ADMIN_PASSWORD);
    await db
      .prepare(
        `INSERT OR IGNORE INTO users
          (username, password_hash, role, disabled, session_version, created_at, updated_at)
         VALUES ('admin', ?, 'admin', 0, 1, ?, ?)`,
      )
      .bind(hash, now, now)
      .run();
    seededAdmin = true;
  }

  // 3) 默认 admin id（最早建的 admin）。用于回填。
  const admin = await db
    .prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1")
    .first<{ id: number }>();
  if (!admin) {
    // 理论不该发生（刚 seed 过或本就有 admin）；无 admin 则跳过回填，避免把数据挂到错误归属。
    return { migrationsApplied: applied, seededAdmin, backfilledSites: 0, backfilledProxies: 0 };
  }
  const adminId = admin.id;

  // 回填前先数一下待回填量（RunResult 不暴露 changes，故用 COUNT 统计供日志/校验）。
  const backfilledSites =
    (await db.prepare('SELECT COUNT(*) AS n FROM sites WHERE user_id IS NULL').first<{ n: number }>())
      ?.n ?? 0;
  const backfilledProxies =
    (await db.prepare('SELECT COUNT(*) AS n FROM proxies WHERE user_id IS NULL').first<{ n: number }>())
      ?.n ?? 0;

  // 4) 回填 user_id + 迁移每用户 settings，放进一个事务（原子，任一失败整体回滚）。
  const keyList = PER_USER_SETTING_KEYS.map((k) => `'${k}'`).join(', ');
  await db.batch([
    // 存量 sites/proxies：NULL user_id → 默认 admin（幂等：回填后不再有 NULL）。
    db.prepare('UPDATE sites SET user_id = ? WHERE user_id IS NULL').bind(adminId),
    db.prepare('UPDATE proxies SET user_id = ? WHERE user_id IS NULL').bind(adminId),
    // 每用户设置：user_id=0 暂存 → 默认 admin。OR IGNORE：admin 若已有该键则保留 admin 的值。
    db
      .prepare(
        `UPDATE OR IGNORE settings SET user_id = ? WHERE user_id = 0 AND key IN (${keyList})`,
      )
      .bind(adminId),
    // 清掉因冲突被 OR IGNORE 跳过、仍滞留在 user_id=0 的每用户键孤儿（幂等收尾）。
    db.prepare(`DELETE FROM settings WHERE user_id = 0 AND key IN (${keyList})`),
  ]);

  return { migrationsApplied: applied, seededAdmin, backfilledSites, backfilledProxies };
}
