// 爬取/签到并落库的共享逻辑：手动（routes）与定时（cron）都调用这里。
// 平台无关：只依赖 shared/db 的 Database 抽象与 shared/scraper 的纯 fetch 逻辑。
import type { Database } from './db';
import type { SiteRow, AppSecrets } from './types';
import { decryptToken } from './crypto';
import { scrapeSite, checkinSite } from './scraper';

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
): Promise<ScrapeOutcome> {
  const now = Date.now();
  const token = await resolveToken(db, secrets, site, now, 'last_error');
  if (token === null) {
    return { site_id: site.id, name: site.name, ok: false, error: '未配置 access token 或解密失败' };
  }

  try {
    const result = await scrapeSite(site.base_url, token);

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
): Promise<CheckinOutcome> {
  const now = Date.now();
  const token = await resolveToken(db, secrets, site, now, 'checkin_result');
  if (token === null) {
    return { site_id: site.id, name: site.name, ok: false, result: '未配置 access token 或解密失败' };
  }

  const outcome = await checkinSite(site.base_url, token);

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
