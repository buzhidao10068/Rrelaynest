// API 路由工厂：登录、站点 CRUD、爬取、签到、设置、导出。全部挂在 /api 下。
// 跨平台：不直接依赖 Workers 的 Env，改由入口注入 Database + AppSecrets。
import { Hono } from 'hono';
import type { AppSecrets, Database, SiteRow, GroupRow, ModelRow, ProxyRow, MakeFetch } from './types';
import {
  createSession,
  sessionCookie,
  clearCookie,
  readSessionCookie,
  verifySession,
  verifyPassword,
} from './auth';
import { encryptToken } from './crypto';
import { scrapeAndStore, checkinAndStore } from './scrape-runner';

// 入口注入的运行时依赖
export interface AppDeps {
  db: Database;
  secrets: AppSecrets;
  // dispatcher 工厂：Node 入口注入（手动爬取/签到走代理），Workers 不注入（直连）
  makeFetch?: MakeFetch;
}

interface SiteInput {
  name?: string;
  base_url?: string;
  token?: string; // 明文，可选；空字符串表示清除
  rate?: number | null;
  currency?: string | null;
  checkin_enabled?: boolean;
  checkin_done?: boolean;
  email?: string | null;
  note?: string | null;
  sort_order?: number | null;
  proxy_id?: number | null; // 绑定代理 id；null=跟随全局，undefined=不改
}

interface ProxyInput {
  name?: string;
  type?: string; // http / https / socks5
  host?: string;
  port?: number;
  username?: string | null;
  password?: string; // 明文，可选；空字符串表示清除，undefined 表示不变
  enabled?: boolean;
}

export function createApp(deps: AppDeps) {
  const { db, secrets, makeFetch } = deps;
  const app = new Hono();

  // ---- 鉴权中间件：/api/login 和 /api/session 之外都要登录 ----
  app.use('/api/*', async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path === '/api/login' || path === '/api/session') return next();
    const token = readSessionCookie(c.req.raw);
    if (!(await verifySession(secrets.SESSION_SECRET, token))) {
      return c.json({ error: '未登录' }, 401);
    }
    return next();
  });

  // ---- 登录相关 ----
  app.post('/api/login', async (c) => {
    const { password } = await c.req
      .json<{ password?: string }>()
      .catch(() => ({ password: undefined }));
    if (!password || !verifyPassword(secrets.ADMIN_PASSWORD, password)) {
      return c.json({ error: '密码错误' }, 401);
    }
    const token = await createSession(secrets.SESSION_SECRET);
    c.header('Set-Cookie', sessionCookie(token));
    return c.json({ ok: true });
  });

  app.post('/api/logout', (c) => {
    c.header('Set-Cookie', clearCookie());
    return c.json({ ok: true });
  });

  // 前端启动时探测是否已登录
  app.get('/api/session', async (c) => {
    const token = readSessionCookie(c.req.raw);
    const ok = await verifySession(secrets.SESSION_SECRET, token);
    return c.json({ authenticated: ok });
  });

  // ---- 站点列表（含分组/模型，不含明文 token）----
  app.get('/api/sites', async (c) => {
    const sites = await db
      .prepare('SELECT * FROM sites ORDER BY sort_order ASC, id ASC')
      .all<SiteRow>();
    const groups = await db.prepare('SELECT * FROM site_groups').all<GroupRow>();
    const models = await db.prepare('SELECT * FROM site_models').all<ModelRow>();

    const groupsBySite = new Map<number, GroupRow[]>();
    for (const g of groups.results) {
      if (!groupsBySite.has(g.site_id)) groupsBySite.set(g.site_id, []);
      groupsBySite.get(g.site_id)!.push(g);
    }
    const modelsBySite = new Map<number, ModelRow[]>();
    for (const m of models.results) {
      if (!modelsBySite.has(m.site_id)) modelsBySite.set(m.site_id, []);
      modelsBySite.get(m.site_id)!.push(m);
    }

    const data = sites.results.map((s) => {
      const { token_encrypted, ...rest } = s;
      return {
        ...rest,
        has_token: !!token_encrypted,
        groups: groupsBySite.get(s.id) ?? [],
        models: modelsBySite.get(s.id) ?? [],
      };
    });
    return c.json({ sites: data });
  });

  // ---- 新增站点 ----
  app.post('/api/sites', async (c) => {
    const body = await c.req.json<SiteInput>();
    if (!body.name || !body.base_url) {
      return c.json({ error: 'name 和 base_url 必填' }, 400);
    }
    const now = Date.now();
    const tokenEnc = body.token
      ? await encryptToken(secrets.ENCRYPTION_KEY, body.token)
      : null;
    const res = await db
      .prepare(
        `INSERT INTO sites
          (name, base_url, token_encrypted, rate, currency, checkin_enabled, email, note, sort_order, proxy_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        body.name,
        body.base_url.replace(/\/+$/, ''),
        tokenEnc,
        body.rate ?? null,
        body.currency ?? 'USD',
        body.checkin_enabled ? 1 : 0,
        body.email ?? null,
        body.note ?? null,
        body.sort_order ?? 0,
        body.proxy_id ?? null,
        now,
        now,
      )
      .run();
    return c.json({ ok: true, id: res.meta.last_row_id });
  });

  // ---- 更新站点 ----
  app.put('/api/sites/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.json<SiteInput>();
    const existing = await db
      .prepare('SELECT * FROM sites WHERE id = ?')
      .bind(id)
      .first<SiteRow>();
    if (!existing) return c.json({ error: '站点不存在' }, 404);

    // token: undefined=不变, ''=清除, 非空=更新
    let tokenEnc = existing.token_encrypted;
    if (body.token !== undefined) {
      tokenEnc = body.token
        ? await encryptToken(secrets.ENCRYPTION_KEY, body.token)
        : null;
    }

    // proxy_id: undefined=不变, null=清除(回落全局/直连), 数字=绑定该代理
    const proxyId =
      body.proxy_id === undefined ? existing.proxy_id : body.proxy_id;

    await db
      .prepare(
        `UPDATE sites SET
          name = ?, base_url = ?, token_encrypted = ?, rate = ?, currency = ?,
          checkin_enabled = ?, checkin_done = ?, email = ?, note = ?, sort_order = ?, proxy_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        body.name ?? existing.name,
        (body.base_url ?? existing.base_url).replace(/\/+$/, ''),
        tokenEnc,
        body.rate ?? existing.rate,
        body.currency ?? existing.currency,
        body.checkin_enabled === undefined
          ? existing.checkin_enabled
          : body.checkin_enabled
            ? 1
            : 0,
        body.checkin_done === undefined
          ? existing.checkin_done
          : body.checkin_done
            ? 1
            : 0,
        body.email ?? existing.email,
        body.note ?? existing.note,
        body.sort_order ?? existing.sort_order,
        proxyId,
        Date.now(),
        id,
      )
      .run();
    return c.json({ ok: true });
  });

  // ---- 删除站点 ----
  app.delete('/api/sites/:id', async (c) => {
    const id = Number(c.req.param('id'));
    await db.prepare('DELETE FROM sites WHERE id = ?').bind(id).run();
    return c.json({ ok: true });
  });

  // ---- 手动爬取单个站点 ----
  app.post('/api/sites/:id/scrape', async (c) => {
    const id = Number(c.req.param('id'));
    const site = await db
      .prepare('SELECT * FROM sites WHERE id = ?')
      .bind(id)
      .first<SiteRow>();
    if (!site) return c.json({ error: '站点不存在' }, 404);
    const result = await scrapeAndStore(db, secrets, site, makeFetch);
    return c.json(result);
  });

  // ---- 手动爬取全部站点 ----
  app.post('/api/scrape-all', async (c) => {
    const sites = await db.prepare('SELECT * FROM sites').all<SiteRow>();
    const results = [];
    for (const site of sites.results) {
      results.push(await scrapeAndStore(db, secrets, site, makeFetch));
    }
    return c.json({ results });
  });

  // ---- 手动签到单个站点（对齐 new-api /api/user/checkin）----
  app.post('/api/sites/:id/checkin', async (c) => {
    const id = Number(c.req.param('id'));
    const site = await db
      .prepare('SELECT * FROM sites WHERE id = ?')
      .bind(id)
      .first<SiteRow>();
    if (!site) return c.json({ error: '站点不存在' }, 404);
    const result = await checkinAndStore(db, secrets, site, makeFetch);
    return c.json(result);
  });

  // ---- 代理池 CRUD（仅 Node/Docker 实际生效；Workers 可读写但爬取时忽略）----
  // 列表：不含密码明文，只报 has_password
  app.get('/api/proxies', async (c) => {
    const rows = await db
      .prepare('SELECT * FROM proxies ORDER BY id ASC')
      .all<ProxyRow>();
    const data = rows.results.map((p) => {
      const { password_encrypted, ...rest } = p;
      return { ...rest, has_password: !!password_encrypted };
    });
    return c.json({ proxies: data });
  });

  app.post('/api/proxies', async (c) => {
    const body = await c.req.json<ProxyInput>();
    if (!body.name || !body.host || !body.port) {
      return c.json({ error: 'name、host、port 必填' }, 400);
    }
    const type = body.type ?? 'http';
    if (!['http', 'https', 'socks5'].includes(type)) {
      return c.json({ error: 'type 仅支持 http/https/socks5' }, 400);
    }
    const now = Date.now();
    const passEnc = body.password
      ? await encryptToken(secrets.ENCRYPTION_KEY, body.password)
      : null;
    const res = await db
      .prepare(
        `INSERT INTO proxies
          (name, type, host, port, username, password_encrypted, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        body.name,
        type,
        body.host,
        body.port,
        body.username ?? null,
        passEnc,
        body.enabled === false ? 0 : 1,
        now,
        now,
      )
      .run();
    return c.json({ ok: true, id: res.meta.last_row_id });
  });

  app.put('/api/proxies/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const body = await c.req.json<ProxyInput>();
    const existing = await db
      .prepare('SELECT * FROM proxies WHERE id = ?')
      .bind(id)
      .first<ProxyRow>();
    if (!existing) return c.json({ error: '代理不存在' }, 404);

    if (body.type !== undefined && !['http', 'https', 'socks5'].includes(body.type)) {
      return c.json({ error: 'type 仅支持 http/https/socks5' }, 400);
    }

    // password: undefined=不变, ''=清除, 非空=更新（与 token 同款）
    let passEnc = existing.password_encrypted;
    if (body.password !== undefined) {
      passEnc = body.password
        ? await encryptToken(secrets.ENCRYPTION_KEY, body.password)
        : null;
    }

    await db
      .prepare(
        `UPDATE proxies SET
          name = ?, type = ?, host = ?, port = ?, username = ?, password_encrypted = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(
        body.name ?? existing.name,
        body.type ?? existing.type,
        body.host ?? existing.host,
        body.port ?? existing.port,
        body.username === undefined ? existing.username : body.username,
        passEnc,
        body.enabled === undefined ? existing.enabled : body.enabled ? 1 : 0,
        Date.now(),
        id,
      )
      .run();
    return c.json({ ok: true });
  });

  // 删除代理：手动把绑定它的站点 proxy_id 置 NULL（不依赖外键级联，D1/better-sqlite3 默认不开外键），
  // 并在它是全局代理时清空 global_proxy_id，使这些站点回落到全局/直连。
  app.delete('/api/proxies/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const stmts = [
      db.prepare('UPDATE sites SET proxy_id = NULL, updated_at = ? WHERE proxy_id = ?').bind(Date.now(), id),
      db.prepare('DELETE FROM proxies WHERE id = ?').bind(id),
    ];
    await db.batch(stmts);
    const gp = await db
      .prepare("SELECT value FROM settings WHERE key = 'global_proxy_id'")
      .first<{ value: string }>();
    if (gp?.value === String(id)) {
      await db
        .prepare("UPDATE settings SET value = '' WHERE key = 'global_proxy_id'")
        .run();
    }
    return c.json({ ok: true });
  });

  // ---- 设置读写 ----
  app.get('/api/settings', async (c) => {
    const rows = await db
      .prepare('SELECT key, value FROM settings')
      .all<{ key: string; value: string }>();
    const map: Record<string, string> = {};
    for (const r of rows.results) map[r.key] = r.value;
    return c.json({ settings: map });
  });

  app.put('/api/settings', async (c) => {
    const body = await c.req.json<Record<string, string>>();
    const stmts = Object.entries(body).map(([k, v]) =>
      db
        .prepare(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?',
        )
        .bind(k, String(v), String(v)),
    );
    if (stmts.length) await db.batch(stmts);
    return c.json({ ok: true });
  });

  // ---- 数据导出（站点清单，不含 token 明文）----
  app.get('/api/export', async (c) => {
    const format = (c.req.query('format') ?? 'json').toLowerCase();
    const sites = await db
      .prepare('SELECT * FROM sites ORDER BY sort_order ASC, id ASC')
      .all<SiteRow>();

    // 导出行：剔除 token_encrypted，附汇率折算 RMB
    const rows = sites.results.map((s) => {
      const balanceRmb =
        s.balance != null && s.rate ? Number((s.balance / s.rate).toFixed(2)) : null;
      return {
        name: s.name,
        base_url: s.base_url,
        rate: s.rate,
        currency: s.currency,
        balance: s.balance,
        balance_rmb: balanceRmb,
        email: s.email,
        note: s.note,
        checkin_enabled: s.checkin_enabled,
        checkin_done: s.checkin_done,
        checkin_result: s.checkin_result,
        last_scraped_at: s.last_scraped_at,
        last_error: s.last_error,
      };
    });

    if (format === 'csv') {
      const headers = [
        'name',
        'base_url',
        'rate',
        'currency',
        'balance',
        'balance_rmb',
        'email',
        'note',
        'checkin_enabled',
        'checkin_done',
        'checkin_result',
        'last_scraped_at',
        'last_error',
      ];
      const escape = (v: unknown): string => {
        if (v == null) return '';
        const s = String(v);
        // CSV 转义：含逗号/引号/换行时用双引号包裹并转义内部引号
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [
        headers.join(','),
        ...rows.map((r) => headers.map((h) => escape((r as Record<string, unknown>)[h])).join(',')),
      ];
      // 前置 BOM，避免 Excel 打开中文乱码
      const csv = '﻿' + lines.join('\r\n');
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="rrelaynest-sites.csv"',
        },
      });
    }

    // 默认 JSON
    return new Response(JSON.stringify({ exported_at: Date.now(), sites: rows }, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="rrelaynest-sites.json"',
      },
    });
  });

  return app;
}
