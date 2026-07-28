// API 路由工厂：登录、站点 CRUD、爬取、签到、设置、导出。全部挂在 /api 下。
// 跨平台：不直接依赖 Workers 的 Env，改由入口注入 Database + AppSecrets。
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import type { AppSecrets, Database, SiteRow, GroupRow, ModelRow, ProxyRow, UserRow, ProbeWordRow, MakeFetch } from './types.js';
import {
  createSession,
  sessionCookie,
  clearCookie,
  readSessionCookie,
  verifySession,
  timingSafeEqual,
} from './auth.js';
import { verifyPassword, hashPassword } from './password.js';
import type { StartupResult } from './startup.js';
import { encryptToken, decryptToken } from './crypto.js';
import { scrapeAndStore, checkinAndStore, readScrapeConfig, resolveFetch } from './scrape-runner.js';
import { mapWithConcurrency } from './concurrency.js';
import { fetchLatestRelease } from './version.js';
import { pingSite, channelTest } from './scraper.js';

// 中间件在查库校验 session_version/disabled 通过后注入的当前用户上下文。
// role 以库里最新值为准（不信 cookie 里的 role），供路由做授权判定。
export interface AuthedUser {
  uid: number;
  role: string;
}

type AppVariables = { user: AuthedUser };

// 入口注入的运行时依赖
export interface AppDeps {
  db: Database;
  secrets: AppSecrets;
  // dispatcher 工厂：Node 入口注入（手动爬取/签到走代理），Workers 不注入（直连）
  makeFetch?: MakeFetch;
  // 已绑定迁移原语的启动迁移函数（组合根注入，见 shared/startup.ts）。
  // Workers 的 /api/admin/bootstrap 首访触发；Node 入口在启动时已自行调过。
  // 未注入则 bootstrap 端点返回 501（该部署不支持首访引导，如 Node 已在启动时完成）。
  runStartup?: (db: Database, secrets: AppSecrets) => Promise<StartupResult>;
  // 当前部署的应用版本（入口从 package.json version 注入）；供 /api/update/check 与 GitHub 比对。
  appVersion?: string;
  // 部署平台标识（'workers' | 'node'）；供 /api/update/check 返回对应平台的升级步骤。
  platform?: string;
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
  probe_text?: string | null; // 单站绑定的测活词；null/''=清除(跟随全局)，undefined=不改
  group_label?: string | null; // 用户自定义分组标签；null/''=未分组，undefined=不改。见 0004 迁移
  balance?: number | null; // 手动填写的余额种子；后续爬取会覆盖。undefined=不改
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

// 引导令牌校验：恒定时间比较，空令牌/空口令一律拒（避免未配置口令时被空令牌绕过）。
function bootstrapTokenOk(token: string, adminPassword: string): boolean {
  if (!token || !adminPassword) return false;
  return timingSafeEqual(token, adminPassword);
}

export function createApp(deps: AppDeps) {
  const { db, secrets, makeFetch, runStartup: runStartupDep } = deps;
  const appVersion = deps.appVersion ?? '0.0.0';
  const platform = deps.platform ?? 'node';
  // 更新检查目标 repo（与前端 about store 的 GITHUB_REPO 一致）。
  const UPDATE_REPO = 'buzhidao10068/Rrelaynest';
  const app = new Hono<{ Variables: AppVariables }>();

  // 无状态验签 + 有状态查库校验：通过则返回库里最新 {uid, role}，否则 null。
  // 步骤（见 multiuser-plan 3.2）：验签+过期 → 回查 users → 不存在/停用 → 版本不匹配 → 全过。
  // 授权用「库里的 role」而非 cookie 里的 role，防降级后旧 cookie 仍带 admin。
  async function authenticate(req: Request): Promise<AuthedUser | null> {
    const claims = await verifySession(secrets.SESSION_SECRET, readSessionCookie(req));
    if (!claims) return null;
    const row = await db
      .prepare('SELECT id, role, disabled, session_version FROM users WHERE id = ?')
      .bind(claims.uid)
      .first<{ id: number; role: string; disabled: number; session_version: number }>();
    if (!row || row.disabled) return null; // 已删 / 已停用 → 立即失效
    if (row.session_version !== claims.ver) return null; // 改密/降级/踢出 → 旧 cookie 作废
    return { uid: row.id, role: row.role };
  }

  // ---- 鉴权中间件：/api/login 和 /api/session 之外都要登录 ----
  app.use('/api/*', async (c, next) => {
    const path = new URL(c.req.url).pathname;
    // /api/admin/bootstrap 免登录：首装时还没有 admin 可登录（先有鸡还是先有蛋）。
    // 它靠 bootstrap 令牌 + 双闸自我把关（见 multiuser-plan 第六节），不构成持续攻击面。
    if (path === '/api/login' || path === '/api/session' || path === '/api/admin/bootstrap') {
      return next();
    }
    const user = await authenticate(c.req.raw);
    if (!user) return c.json({ error: '未登录' }, 401);
    c.set('user', user); // 后续路由通过 c.get('user') 拿到库里最新的 {uid, role}
    return next();
  });

  // admin-only 闸：role 以库里为准（authenticate 已注入最新 role，不信 cookie）。
  // 挂在 /api/admin/users* 上（bootstrap 免登录，不经此闸——它在上面白名单里）。
  const requireAdmin: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
    if (c.get('user').role !== 'admin') return c.json({ error: '需要管理员权限' }, 403);
    return next();
  };

  // ---- 登录相关 ----
  app.post('/api/login', async (c) => {
    const { username, password } = await c.req
      .json<{ username?: string; password?: string }>()
      .catch(() => ({ username: undefined, password: undefined }));
    // 用户名不存在与密码错误返回相同文案，避免枚举用户名（见 multiuser-plan 3.3）。
    const fail = () => c.json({ error: '用户名或密码错误' }, 401);
    if (!username || !password) return fail();
    const user = await db
      .prepare('SELECT * FROM users WHERE username = ? AND disabled = 0')
      .bind(username)
      .first<UserRow>();
    if (!user) return fail();
    if (!(await verifyPassword(password, user.password_hash))) return fail();
    const token = await createSession(
      secrets.SESSION_SECRET,
      user.id,
      user.role,
      user.session_version,
    );
    c.header('Set-Cookie', sessionCookie(token));
    return c.json({ ok: true });
  });

  app.post('/api/logout', (c) => {
    c.header('Set-Cookie', clearCookie());
    return c.json({ ok: true });
  });

  // 前端启动时探测是否已登录；已登录时附带用户名与角色（供前端渲染菜单/权限）。
  app.get('/api/session', async (c) => {
    const user = await authenticate(c.req.raw);
    if (!user) return c.json({ authenticated: false });
    const row = await db
      .prepare('SELECT username FROM users WHERE id = ?')
      .bind(user.uid)
      .first<{ username: string }>();
    return c.json({ authenticated: true, id: user.uid, username: row?.username ?? '', role: user.role });
  });

  // ---- Workers 首装引导（见 multiuser-plan 第六节，选项 1）----
  // Workers 无启动钩子，故 seed + 回填由本端点首访触发（Node 侧已在进程启动时自动完成，
  // 无需调本端点，但调用也安全——幂等）。双闸 + 令牌，防部署窗口被抢先 seed：
  //   令牌闸：Bearer 必须等于 ADMIN_PASSWORD（不另设 env；恒定时间比较）。
  //   幂等闸：runStartupMigration 内部仅在 users 空时 seed，已初始化则空操作。
  // 本端点在中间件白名单内（此刻还没有 admin 可登录，无法要求会话）。
  app.post('/api/admin/bootstrap', async (c) => {
    const auth = c.req.header('Authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!bootstrapTokenOk(token, secrets.ADMIN_PASSWORD)) {
      return c.json({ error: '引导令牌无效' }, 401);
    }
    // 未注入 runStartup 的部署（如 Node 已在启动时完成引导）不支持首访引导。
    if (!runStartupDep) {
      return c.json({ error: '该部署不支持首访引导（启动时已完成）' }, 501);
    }
    // 幂等闸：已有 admin 则直接返回，绝不重复 seed / 回填。
    const existing = await db
      .prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
      .first<{ id: number }>();
    if (existing) {
      return c.json({ ok: true, alreadyInitialized: true });
    }
    const result = await runStartupDep(db, secrets);
    return c.json({ ok: true, alreadyInitialized: false, ...result });
  });

  // 当前用户信息（见 multiuser-plan 4.1 /api/me）。
  app.get('/api/me', async (c) => {
    const { uid } = c.get('user');
    const row = await db
      .prepare('SELECT id, username, role FROM users WHERE id = ?')
      .bind(uid)
      .first<{ id: number; username: string; role: string }>();
    if (!row) return c.json({ error: '用户不存在' }, 404);
    return c.json(row);
  });

  // 改自己的登录密码：验当前密码 → 换新哈希 → session_version +1（吊销本用户其余会话/设备）。
  // 因 +1 会作废包含本次请求在内的所有旧 cookie，故立即用新版本重签发当前会话 cookie，
  // 让「改密者本人」不被登出，同时别处旧 cookie 全部失效（中间件回查 session_version 不匹配即拒）。
  app.post('/api/account/password', async (c) => {
    const { uid } = c.get('user');
    const body = await c.req
      .json<{ current?: string; next?: string }>()
      .catch(() => ({}) as { current?: string; next?: string });
    const current = body.current ?? '';
    const next = body.next ?? '';
    if (!current || !next) return c.json({ error: '当前密码与新密码均必填' }, 400);
    if (next.length < 8) return c.json({ error: '新密码至少 8 位' }, 400);

    const user = await db
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(uid)
      .first<UserRow>();
    if (!user) return c.json({ error: '用户不存在' }, 404);
    if (!(await verifyPassword(current, user.password_hash))) {
      return c.json({ error: '当前密码错误' }, 400);
    }
    if (await verifyPassword(next, user.password_hash)) {
      return c.json({ error: '新密码不能与当前密码相同' }, 400);
    }

    const nextHash = await hashPassword(next);
    const nextVer = user.session_version + 1; // 吊销旧会话（含别处已登录的设备）
    await db
      .prepare('UPDATE users SET password_hash = ?, session_version = ?, updated_at = ? WHERE id = ?')
      .bind(nextHash, nextVer, Date.now(), uid)
      .run();

    // 用新 session_version 重签发本会话 cookie，避免改密者本人被自己踢下线。
    const token = await createSession(secrets.SESSION_SECRET, user.id, user.role, nextVer);
    c.header('Set-Cookie', sessionCookie(token));
    return c.json({ ok: true });
  });

  // 检查更新：后端代理 GitHub Releases（避免前端直连的 CORS/限流，并隐藏 repo 细节）。
  // 用平台默认 fetch 直连 GitHub（不走站点代理池——代理是给中转站用的，与 GitHub 无关）。
  // 不做应用内自更新：仅返回是否有新版 + 按平台的手动升级步骤（见 memory update-check-backend-todo）。
  app.get('/api/update/check', async (c) => {
    const result = await fetchLatestRelease(UPDATE_REPO, appVersion, platform);
    return c.json(result);
  });

  // ==== admin-only 用户管理（见 multiuser-plan 4.2）====
  // 全部经 requireAdmin 闸。即时吊销靠 session_version +1：停用/改密/降级/删号后
  // 目标用户已签发的 cookie 立即失效（中间件每请求比对 ver，见第三节 8.3 用例 15–18）。

  // 列所有用户（不含 password_hash）。
  app.get('/api/admin/users', requireAdmin, async (c) => {
    // 附带站点数（相关子查询）：用户卡片展示「N 个站点」，admin 低频路径，成本可接受。
    const rows = await db
      .prepare(
        `SELECT id, username, role, disabled, session_version, created_at, updated_at,
                (SELECT COUNT(*) FROM sites WHERE sites.user_id = users.id) AS sites
         FROM users ORDER BY id ASC`,
      )
      .all<Omit<UserRow, 'password_hash'> & { sites: number }>();
    return c.json({ users: rows.results });
  });

  // 创建用户 {username, password, role}。username 查重（409）；role 仅 admin/user。
  app.post('/api/admin/users', requireAdmin, async (c) => {
    const body = await c.req
      .json<{ username?: string; password?: string; role?: string }>()
      .catch(() => ({}) as { username?: string; password?: string; role?: string });
    const username = body.username?.trim();
    const password = body.password;
    const role = body.role ?? 'user';
    if (!username || !password) return c.json({ error: 'username 和 password 必填' }, 400);
    if (role !== 'admin' && role !== 'user') return c.json({ error: 'role 仅支持 admin/user' }, 400);
    // 查重：username UNIQUE，先查一次给出友好 409（兜底仍靠唯一索引）。
    const dup = await db
      .prepare('SELECT id FROM users WHERE username = ?')
      .bind(username)
      .first<{ id: number }>();
    if (dup) return c.json({ error: '用户名已存在' }, 409);
    const now = Date.now();
    const hash = await hashPassword(password);
    const res = await db
      .prepare(
        `INSERT INTO users (username, password_hash, role, disabled, session_version, created_at, updated_at)
         VALUES (?, ?, ?, 0, 1, ?, ?)`,
      )
      .bind(username, hash, role, now, now)
      .run();
    return c.json({ ok: true, id: res.meta.last_row_id });
  });

  // 改用户：角色 / 停用 / 重置密码。任一涉及安全的变更都 session_version +1（即时吊销）。
  // 禁止 admin 停用/降级/改自己（防锁死，见 8.2 用例 12）——重置自己密码允许。
  app.put('/api/admin/users/:id', requireAdmin, async (c) => {
    const { uid } = c.get('user');
    const id = Number(c.req.param('id'));
    const body = await c.req
      .json<{ role?: string; disabled?: boolean; password?: string }>()
      .catch(() => ({}) as { role?: string; disabled?: boolean; password?: string });
    const target = await db
      .prepare('SELECT * FROM users WHERE id = ?')
      .bind(id)
      .first<UserRow>();
    if (!target) return c.json({ error: '用户不存在' }, 404);

    const changingRole = body.role !== undefined && body.role !== target.role;
    const changingDisabled =
      body.disabled !== undefined && (body.disabled ? 1 : 0) !== target.disabled;
    const changingPassword = body.password !== undefined && body.password !== '';

    if (changingRole && body.role !== 'admin' && body.role !== 'user') {
      return c.json({ error: 'role 仅支持 admin/user' }, 400);
    }
    // 防锁死：admin 不能停用自己、不能把自己降级。
    if (id === uid) {
      if (changingDisabled && body.disabled) {
        return c.json({ error: '不能停用自己' }, 400);
      }
      if (changingRole && body.role !== 'admin') {
        return c.json({ error: '不能降级自己' }, 400);
      }
    }

    const nextRole = changingRole ? body.role! : target.role;
    const nextDisabled = body.disabled === undefined ? target.disabled : body.disabled ? 1 : 0;
    let nextHash = target.password_hash;
    if (changingPassword) nextHash = await hashPassword(body.password!);

    // 停用/改密/降级或升级 → session_version +1，吊销该用户全部旧会话。
    const bump = changingRole || changingDisabled || changingPassword;
    const nextVer = bump ? target.session_version + 1 : target.session_version;

    await db
      .prepare(
        `UPDATE users SET role = ?, disabled = ?, password_hash = ?, session_version = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(nextRole, nextDisabled, nextHash, nextVer, Date.now(), id)
      .run();
    return c.json({ ok: true });
  });

  // 删用户：级联删其 site_groups/site_models（JOIN sites）→ sites → proxies → settings → users 行。
  // 一个 batch 事务，避免孤儿数据（见 8.2 用例 13）。禁止删自己（防锁死）。
  app.delete('/api/admin/users/:id', requireAdmin, async (c) => {
    const { uid } = c.get('user');
    const id = Number(c.req.param('id'));
    if (id === uid) return c.json({ error: '不能删除自己' }, 400);
    const target = await db
      .prepare('SELECT id FROM users WHERE id = ?')
      .bind(id)
      .first<{ id: number }>();
    if (!target) return c.json({ error: '用户不存在' }, 404);
    await db.batch([
      db
        .prepare(
          'DELETE FROM site_groups WHERE site_id IN (SELECT id FROM sites WHERE user_id = ?)',
        )
        .bind(id),
      db
        .prepare(
          'DELETE FROM site_models WHERE site_id IN (SELECT id FROM sites WHERE user_id = ?)',
        )
        .bind(id),
      db.prepare('DELETE FROM sites WHERE user_id = ?').bind(id),
      db.prepare('DELETE FROM proxies WHERE user_id = ?').bind(id),
      db.prepare('DELETE FROM settings WHERE user_id = ?').bind(id),
      db.prepare('DELETE FROM users WHERE id = ?').bind(id),
    ]);
    return c.json({ ok: true });
  });

  // ==== admin 跨用户只读 + 条款解锁（见 multiuser-plan 4.3 / 8.4）====
  // 方案 A：业务端点永远只看自己；他人数据走这组物理隔离的、只读的、admin-only 端点。
  // 双校验：requireAdmin（已挂在路由上）+ 再查该 admin 的 ack 标记存在。撤销 ack 后立即拒。

  // 条款 ack 闸：settings (user_id = 该 admin, key = 'admin_global_view_ack') 非空即放行。
  // 每次跨用户读多一次 settings 查询（admin 低频路径，可接受）。
  const requireGlobalViewAck: MiddlewareHandler<{ Variables: AppVariables }> = async (c, next) => {
    const { uid } = c.get('user');
    const ack = await db
      .prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'admin_global_view_ack'")
      .bind(uid)
      .first<{ value: string }>();
    if (!ack || !ack.value) return c.json({ error: '未解锁跨用户查看（需先在设置页阅读并同意条款）' }, 403);
    return next();
  };

  // 目标用户存在性：不存在返回 404（这里 admin 已鉴权，不必伪装成 403）。
  async function requireExistingUser(uid: number): Promise<boolean> {
    const row = await db.prepare('SELECT id FROM users WHERE id = ?').bind(uid).first<{ id: number }>();
    return !!row;
  }

  // 只读列出指定用户的站点（含分组/模型摘要，剔除 token）。无对应写/删/爬取版本。
  app.get('/api/admin/users/:uid/sites', requireAdmin, requireGlobalViewAck, async (c) => {
    const targetUid = Number(c.req.param('uid'));
    if (!(await requireExistingUser(targetUid))) return c.json({ error: '用户不存在' }, 404);
    const sites = await db
      .prepare('SELECT * FROM sites WHERE user_id = ? ORDER BY sort_order ASC, id ASC')
      .bind(targetUid)
      .all<SiteRow>();
    const groups = await db
      .prepare('SELECT g.* FROM site_groups g JOIN sites s ON s.id = g.site_id WHERE s.user_id = ?')
      .bind(targetUid)
      .all<GroupRow>();
    const models = await db
      .prepare('SELECT m.* FROM site_models m JOIN sites s ON s.id = m.site_id WHERE s.user_id = ?')
      .bind(targetUid)
      .all<ModelRow>();

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

  // 只读列出指定用户的代理（剔除密码）。
  app.get('/api/admin/users/:uid/proxies', requireAdmin, requireGlobalViewAck, async (c) => {
    const targetUid = Number(c.req.param('uid'));
    if (!(await requireExistingUser(targetUid))) return c.json({ error: '用户不存在' }, 404);
    const rows = await db
      .prepare('SELECT * FROM proxies WHERE user_id = ? ORDER BY id ASC')
      .bind(targetUid)
      .all<ProxyRow>();
    const data = rows.results.map((p) => {
      const { password_encrypted, ...rest } = p;
      return { ...rest, has_password: !!password_encrypted };
    });
    return c.json({ proxies: data });
  });

  // ---- 站点列表（含分组/模型，不含明文 token）----
  // 只列当前用户的站点；分组/模型经 JOIN sites 过滤 user（site_groups/site_models 无 user_id 列，
  // 靠 site_id → sites.user_id 间接归属，见 multiuser-plan 1.2）。
  app.get('/api/sites', async (c) => {
    const { uid } = c.get('user');
    const sites = await db
      .prepare('SELECT * FROM sites WHERE user_id = ? ORDER BY sort_order ASC, id ASC')
      .bind(uid)
      .all<SiteRow>();
    const groups = await db
      .prepare(
        'SELECT g.* FROM site_groups g JOIN sites s ON s.id = g.site_id WHERE s.user_id = ?',
      )
      .bind(uid)
      .all<GroupRow>();
    const models = await db
      .prepare(
        'SELECT m.* FROM site_models m JOIN sites s ON s.id = m.site_id WHERE s.user_id = ?',
      )
      .bind(uid)
      .all<ModelRow>();

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
    const { uid } = c.get('user');
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
          (user_id, name, base_url, token_encrypted, rate, currency, balance, checkin_enabled, email, note, sort_order, proxy_id, probe_text, group_label, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        uid,
        body.name,
        body.base_url.replace(/\/+$/, ''),
        tokenEnc,
        body.rate ?? null,
        body.currency ?? 'USD',
        body.balance ?? null,
        body.checkin_enabled ? 1 : 0,
        body.email ?? null,
        body.note ?? null,
        body.sort_order ?? 0,
        body.proxy_id ?? null,
        body.probe_text || null,
        body.group_label || null,
        now,
        now,
      )
      .run();
    return c.json({ ok: true, id: res.meta.last_row_id });
  });

  // ---- 更新站点 ----
  app.put('/api/sites/:id', async (c) => {
    const { uid } = c.get('user');
    const id = Number(c.req.param('id'));
    const body = await c.req.json<SiteInput>();
    const existing = await db
      .prepare('SELECT * FROM sites WHERE id = ? AND user_id = ?')
      .bind(id, uid)
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

    // probe_text: undefined=不变, ''=清除(回落全局默认词), 非空=绑定该测活词
    const probeText =
      body.probe_text === undefined ? existing.probe_text : body.probe_text || null;

    // group_label: undefined=不变, ''=清除(不分组), 非空=用户分组名
    const groupLabel =
      body.group_label === undefined ? existing.group_label : body.group_label || null;

    // balance: undefined=不变(保留爬取值), null/数字=显式覆盖(如手动填种子余额)
    const balance = body.balance === undefined ? existing.balance : body.balance;

    await db
      .prepare(
        `UPDATE sites SET
          name = ?, base_url = ?, token_encrypted = ?, rate = ?, currency = ?, balance = ?,
          checkin_enabled = ?, checkin_done = ?, email = ?, note = ?, sort_order = ?, proxy_id = ?, probe_text = ?, group_label = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .bind(
        body.name ?? existing.name,
        (body.base_url ?? existing.base_url).replace(/\/+$/, ''),
        tokenEnc,
        body.rate ?? existing.rate,
        body.currency ?? existing.currency,
        balance,
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
        probeText,
        groupLabel,
        Date.now(),
        id,
        uid,
      )
      .run();
    return c.json({ ok: true });
  });

  // ---- 删除站点 ----
  app.delete('/api/sites/:id', async (c) => {
    const { uid } = c.get('user');
    const id = Number(c.req.param('id'));
    // 先确认属己（RunResult 不暴露 changes，故用 SELECT 判定存在性+归属）。
    // 不存在或不属己都返回 404，不区分「不存在」与「无权」，避免探测他人资源 id。
    const owned = await db
      .prepare('SELECT id FROM sites WHERE id = ? AND user_id = ?')
      .bind(id, uid)
      .first<{ id: number }>();
    if (!owned) return c.json({ error: '站点不存在' }, 404);
    await db.prepare('DELETE FROM sites WHERE id = ? AND user_id = ?').bind(id, uid).run();
    return c.json({ ok: true });
  });

  // ---- 手动爬取单个站点 ----
  app.post('/api/sites/:id/scrape', async (c) => {
    const { uid } = c.get('user');
    const id = Number(c.req.param('id'));
    const site = await db
      .prepare('SELECT * FROM sites WHERE id = ? AND user_id = ?')
      .bind(id, uid)
      .first<SiteRow>();
    if (!site) return c.json({ error: '站点不存在' }, 404); // 不属己也 404，避免探测
    const { config } = await readScrapeConfig(db, uid);
    const result = await scrapeAndStore(db, secrets, site, makeFetch, config);
    return c.json(result);
  });

  // ---- 手动爬取全部站点（仅自己的）----
  // 应用每用户 scrape 配置：受限并发 + 单站超时 + 失败重试（见 [[scraper-backend-concurrency-todo]]）。
  app.post('/api/scrape-all', async (c) => {
    const { uid } = c.get('user');
    const sites = await db
      .prepare('SELECT * FROM sites WHERE user_id = ?')
      .bind(uid)
      .all<SiteRow>();
    const { config, concurrency } = await readScrapeConfig(db, uid);
    // scrapeAndStore 自身吞异常返回 outcome，故 mapper 不抛，可安全用受限并发。
    const results = await mapWithConcurrency(sites.results, concurrency, (site) =>
      scrapeAndStore(db, secrets, site, makeFetch, config),
    );
    return c.json({ results });
  });

  // ---- 手动签到单个站点（对齐 new-api /api/user/checkin）----
  app.post('/api/sites/:id/checkin', async (c) => {
    const { uid } = c.get('user');
    const id = Number(c.req.param('id'));
    const site = await db
      .prepare('SELECT * FROM sites WHERE id = ? AND user_id = ?')
      .bind(id, uid)
      .first<SiteRow>();
    if (!site) return c.json({ error: '站点不存在' }, 404); // 不属己也 404，避免探测
    const { config } = await readScrapeConfig(db, uid);
    const result = await checkinAndStore(db, secrets, site, makeFetch, config);
    return c.json(result);
  });

  // ==== 测活词池 CRUD（每用户隔离，见 0003 迁移 + 前端 stores/probes.ts）====
  // text 为业务唯一键（UNIQUE(user_id, text)）；站点以 sites.probe_text 单值绑定。
  // 全局默认词/开关走每用户 settings(probe_global_text / probe_global_enabled)，不在此表。
  app.get('/api/probe-words', async (c) => {
    const { uid } = c.get('user');
    const rows = await db
      .prepare('SELECT * FROM probe_words WHERE user_id = ? ORDER BY id ASC')
      .bind(uid)
      .all<ProbeWordRow>();
    return c.json({ words: rows.results });
  });

  // 新增测活词。text 必填、查重（409）。默认 enabled。
  app.post('/api/probe-words', async (c) => {
    const { uid } = c.get('user');
    const body = await c.req
      .json<{ text?: string; enabled?: boolean }>()
      .catch(() => ({}) as { text?: string; enabled?: boolean });
    const text = body.text?.trim();
    if (!text) return c.json({ error: 'text 必填' }, 400);
    const dup = await db
      .prepare('SELECT id FROM probe_words WHERE user_id = ? AND text = ?')
      .bind(uid, text)
      .first<{ id: number }>();
    if (dup) return c.json({ error: '该测活词已存在' }, 409);
    const now = Date.now();
    const res = await db
      .prepare(
        'INSERT INTO probe_words (user_id, text, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .bind(uid, text, body.enabled === false ? 0 : 1, now, now)
      .run();
    return c.json({ ok: true, id: res.meta.last_row_id });
  });

  // 改测活词：改名 / 启停。改名会级联同步本用户 sites.probe_text 与全局默认词 setting。
  // 停用的若正是全局默认词，则清空全局默认词 setting（前端据此回落）。
  app.put('/api/probe-words/:id', async (c) => {
    const { uid } = c.get('user');
    const id = Number(c.req.param('id'));
    const body = await c.req
      .json<{ text?: string; enabled?: boolean }>()
      .catch(() => ({}) as { text?: string; enabled?: boolean });
    const existing = await db
      .prepare('SELECT * FROM probe_words WHERE id = ? AND user_id = ?')
      .bind(id, uid)
      .first<ProbeWordRow>();
    if (!existing) return c.json({ error: '测活词不存在' }, 404); // 不属己也 404

    const nextText = body.text?.trim() || existing.text;
    const nextEnabled = body.enabled === undefined ? existing.enabled : body.enabled ? 1 : 0;

    // 改名查重（排除自身）。
    if (nextText !== existing.text) {
      const dup = await db
        .prepare('SELECT id FROM probe_words WHERE user_id = ? AND text = ? AND id != ?')
        .bind(uid, nextText, id)
        .first<{ id: number }>();
      if (dup) return c.json({ error: '该测活词已存在' }, 409);
    }

    const now = Date.now();
    const stmts = [
      db
        .prepare('UPDATE probe_words SET text = ?, enabled = ?, updated_at = ? WHERE id = ? AND user_id = ?')
        .bind(nextText, nextEnabled, now, id, uid),
    ];
    // 改名级联：本用户名下绑定旧词的站点改指新词。
    if (nextText !== existing.text) {
      stmts.push(
        db
          .prepare('UPDATE sites SET probe_text = ?, updated_at = ? WHERE user_id = ? AND probe_text = ?')
          .bind(nextText, now, uid, existing.text),
      );
      // 全局默认词若指向旧词，同步改名。
      stmts.push(
        db
          .prepare(
            "UPDATE settings SET value = ? WHERE user_id = ? AND key = 'probe_global_text' AND value = ?",
          )
          .bind(nextText, uid, existing.text),
      );
    }
    await db.batch(stmts);
    return c.json({ ok: true });
  });

  // 删测活词：解绑本用户名下引用它的站点（probe_text 置 NULL，回落全局）+
  // 若它是全局默认词则清空该 setting。
  app.delete('/api/probe-words/:id', async (c) => {
    const { uid } = c.get('user');
    const id = Number(c.req.param('id'));
    const existing = await db
      .prepare('SELECT * FROM probe_words WHERE id = ? AND user_id = ?')
      .bind(id, uid)
      .first<ProbeWordRow>();
    if (!existing) return c.json({ error: '测活词不存在' }, 404);
    const now = Date.now();
    await db.batch([
      db
        .prepare('UPDATE sites SET probe_text = NULL, updated_at = ? WHERE user_id = ? AND probe_text = ?')
        .bind(now, uid, existing.text),
      db
        .prepare(
          "UPDATE settings SET value = '' WHERE user_id = ? AND key = 'probe_global_text' AND value = ?",
        )
        .bind(uid, existing.text),
      db.prepare('DELETE FROM probe_words WHERE id = ? AND user_id = ?').bind(id, uid),
    ]);
    return c.json({ ok: true });
  });

  // ==== 测活：连通性探测 + 渠道测试（见 [[activity-probe-backend-todo]]）====
  // 都按站点归属查（WHERE user_id），不属己 404。走站点绑定的代理（resolveFetch）。

  // 测试连接：GET /api/pricing 量响应耗时，判可达 / 较慢 / 不可达。不改库（纯探测）。
  app.post('/api/sites/:id/ping', async (c) => {
    const { uid } = c.get('user');
    const id = Number(c.req.param('id'));
    const site = await db
      .prepare('SELECT * FROM sites WHERE id = ? AND user_id = ?')
      .bind(id, uid)
      .first<SiteRow>();
    if (!site) return c.json({ error: '站点不存在' }, 404);
    const token = site.token_encrypted
      ? await decryptToken(secrets.ENCRYPTION_KEY, site.token_encrypted).catch(() => '')
      : '';
    const { config } = await readScrapeConfig(db, uid);
    const fetchImpl = await resolveFetch(db, secrets, site, makeFetch);
    const result = await pingSite(site.base_url, token, {
      fetchImpl,
      timeoutMs: config.timeoutMs,
    });
    return c.json(result);
  });

  // 渠道测试：用站点某模型发一句测活词，看模型能否回复。
  // 测活词解析（对齐前端 effectiveProbe）：单站绑定(sites.probe_text) > 全局默认词
  // (probe_global_text，且 probe_global_enabled 开)；都无 → 跳过（返回 skipped）。
  // 且解析出的词必须是本用户仍启用的词条，否则视作无效 → 跳过。
  // 测试用的 model 由前端传入（通常取该站已爬到的首个模型）；缺失回落 'gpt-3.5-turbo'。
  app.post('/api/sites/:id/channel-test', async (c) => {
    const { uid } = c.get('user');
    const id = Number(c.req.param('id'));
    const body = await c.req
      .json<{ model?: string }>()
      .catch(() => ({}) as { model?: string });
    const site = await db
      .prepare('SELECT * FROM sites WHERE id = ? AND user_id = ?')
      .bind(id, uid)
      .first<SiteRow>();
    if (!site) return c.json({ error: '站点不存在' }, 404);
    if (!site.token_encrypted) return c.json({ error: '未配置 access token' }, 400);

    // 本用户启用中的测活词集合，用于校验解析出的词有效。
    const enabledRows = await db
      .prepare('SELECT text FROM probe_words WHERE user_id = ? AND enabled = 1')
      .bind(uid)
      .all<{ text: string }>();
    const enabled = new Set(enabledRows.results.map((r) => r.text));

    // 全局默认词与开关（每用户 settings）。
    const settingRows = await db
      .prepare(
        "SELECT key, value FROM settings WHERE user_id = ? AND key IN ('probe_global_text','probe_global_enabled')",
      )
      .bind(uid)
      .all<{ key: string; value: string }>();
    const sMap: Record<string, string> = {};
    for (const r of settingRows.results) sMap[r.key] = r.value;
    const globalText = sMap.probe_global_text ?? '';
    const globalOn = sMap.probe_global_enabled !== '0'; // 缺省视为开（与前端一致）

    // effectiveProbe：单站绑定优先（须启用）；否则全局默认词（开关开且启用）；都无 → 空串。
    let probe = '';
    if (site.probe_text && enabled.has(site.probe_text)) probe = site.probe_text;
    else if (globalOn && globalText && enabled.has(globalText)) probe = globalText;
    if (!probe) {
      return c.json({ ok: false, skipped: true, message: '未配置有效测活词，跳过渠道测试' });
    }

    const model = body.model?.trim() || 'gpt-3.5-turbo';
    const token = await decryptToken(secrets.ENCRYPTION_KEY, site.token_encrypted).catch(() => '');
    if (!token) return c.json({ error: 'token 解密失败' }, 500);
    const { config } = await readScrapeConfig(db, uid);
    const fetchImpl = await resolveFetch(db, secrets, site, makeFetch);
    const result = await channelTest(site.base_url, token, probe, model, {
      fetchImpl,
      timeoutMs: config.timeoutMs,
    });
    return c.json(result);
  });

  // ---- 代理池 CRUD（仅 Node/Docker 实际生效；Workers 可读写但爬取时忽略）----
  // 列表：不含密码明文，只报 has_password
  app.get('/api/proxies', async (c) => {
    const { uid } = c.get('user');
    const rows = await db
      .prepare('SELECT * FROM proxies WHERE user_id = ? ORDER BY id ASC')
      .bind(uid)
      .all<ProxyRow>();
    const data = rows.results.map((p) => {
      const { password_encrypted, ...rest } = p;
      return { ...rest, has_password: !!password_encrypted };
    });
    return c.json({ proxies: data });
  });

  app.post('/api/proxies', async (c) => {
    const { uid } = c.get('user');
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
          (user_id, name, type, host, port, username, password_encrypted, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        uid,
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
    const { uid } = c.get('user');
    const id = Number(c.req.param('id'));
    const body = await c.req.json<ProxyInput>();
    const existing = await db
      .prepare('SELECT * FROM proxies WHERE id = ? AND user_id = ?')
      .bind(id, uid)
      .first<ProxyRow>();
    if (!existing) return c.json({ error: '代理不存在' }, 404); // 不属己也 404

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
         WHERE id = ? AND user_id = ?`,
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
        uid,
      )
      .run();
    return c.json({ ok: true });
  });

  // 删除代理：手动把绑定它的站点 proxy_id 置 NULL（不依赖外键级联，D1/better-sqlite3 默认不开外键），
  // 并在它是全局代理时清空 global_proxy_id，使这些站点回落到全局/直连。
  app.delete('/api/proxies/:id', async (c) => {
    const { uid } = c.get('user');
    const id = Number(c.req.param('id'));
    // 先确认代理属己（不存在或不属己都 404，避免探测他人代理 id）。
    const owned = await db
      .prepare('SELECT id FROM proxies WHERE id = ? AND user_id = ?')
      .bind(id, uid)
      .first<{ id: number }>();
    if (!owned) return c.json({ error: '代理不存在' }, 404);
    // 联动只清自己的：解绑自己名下引用该代理的站点，删除该代理。全部带 user_id 兜底。
    const stmts = [
      db
        .prepare('UPDATE sites SET proxy_id = NULL, updated_at = ? WHERE proxy_id = ? AND user_id = ?')
        .bind(Date.now(), id, uid),
      db.prepare('DELETE FROM proxies WHERE id = ? AND user_id = ?').bind(id, uid),
    ];
    await db.batch(stmts);
    // 若它是本用户的全局代理，清空本用户的 global_proxy_id（每用户设置，见 multiuser-plan 1.3）。
    const gp = await db
      .prepare("SELECT value FROM settings WHERE user_id = ? AND key = 'global_proxy_id'")
      .bind(uid)
      .first<{ value: string }>();
    if (gp?.value === String(id)) {
      await db
        .prepare("UPDATE settings SET value = '' WHERE user_id = ? AND key = 'global_proxy_id'")
        .bind(uid)
        .run();
    }
    return c.json({ ok: true });
  });

  // ---- 设置读写 ----
  // 读设置：合并「本用户键」与「系统级键(user_id=0)」；同名键以本用户为准。
  // 系统级键对 user 只读（无对应写路径），见 multiuser-plan 4.1。
  app.get('/api/settings', async (c) => {
    const { uid } = c.get('user');
    const rows = await db
      .prepare('SELECT user_id, key, value FROM settings WHERE user_id = ? OR user_id = 0')
      .bind(uid)
      .all<{ user_id: number; key: string; value: string }>();
    const map: Record<string, string> = {};
    // 先铺系统级(0)，再用本用户键覆盖，保证同名以本用户为准。
    for (const r of rows.results) if (r.user_id === 0) map[r.key] = r.value;
    for (const r of rows.results) if (r.user_id === uid) map[r.key] = r.value;
    return c.json({ settings: map });
  });

  // 写设置：只写「本用户键」。系统级键(如未来的全局开关)由 admin 专用路径管理，
  // 这里一律落到 user_id = uid（复合主键 (user_id,key) upsert），user 无法写 user_id=0。
  app.put('/api/settings', async (c) => {
    const { uid } = c.get('user');
    const body = await c.req.json<Record<string, string>>();
    const stmts = Object.entries(body).map(([k, v]) =>
      db
        .prepare(
          'INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = ?',
        )
        .bind(uid, k, String(v), String(v)),
    );
    if (stmts.length) await db.batch(stmts);
    return c.json({ ok: true });
  });

  // ---- 数据导出（站点清单，不含 token 明文）----
  app.get('/api/export', async (c) => {
    const { uid } = c.get('user');
    const format = (c.req.query('format') ?? 'json').toLowerCase();
    const sites = await db
      .prepare('SELECT * FROM sites WHERE user_id = ? ORDER BY sort_order ASC, id ASC')
      .bind(uid)
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
