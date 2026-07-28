// 会话签名 cookie（HMAC-SHA256）。payload 从「仅过期时间」升级为
// {uid, role, ver, exp}：uid/role 供路由做数据隔离与授权，ver 是签发时该用户的
// users.session_version 快照——即时吊销核心（见 multiuser-plan 第三节）。
// verifySession 只做「签名 + 过期」的无状态校验；session_version / disabled 的
// 有状态查库校验由中间件承担（拿 uid 回查 users 表）。
// 基于 Web Crypto（crypto.subtle），Workers 与 Node 20+ 通用（见 TD2）。
//
// 登录密码校验已移出本模块：单向哈希在 shared/password.ts，登录查 users 表。
// 旧的明文 verifyPassword(adminPassword, ...) 随单用户模式一并删除，避免误用。

const COOKIE_NAME = 'rn_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

// 会话内容：签发时写入，verifySession 校验签名+过期后原样返回（role 仅作参考，
// 授权判定以库里最新 role 为准，见中间件）。
export interface SessionClaims {
  uid: number;
  role: string;
  ver: number; // 签发时的 users.session_version 快照
}

const enc = new TextEncoder();

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return new Uint8Array(sig);
}

// 恒定时间比较，避免时序攻击。导出供 bootstrap 令牌校验复用。
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// 生成会话 token：payload = b64url(JSON.stringify({uid, role, ver, exp}))，附 HMAC 签名。
export async function createSession(
  sessionSecret: string,
  uid: number,
  role: string,
  ver: number,
): Promise<string> {
  const claims = { uid, role, ver, exp: Date.now() + SESSION_TTL_MS };
  const payload = b64urlEncode(enc.encode(JSON.stringify(claims)));
  const sig = b64urlEncode(await hmac(sessionSecret, payload));
  return `${payload}.${sig}`;
}

// 无状态校验：验签 + 未过期 + payload 结构合法。通过返回 claims，否则 null。
// ⚠ 只保证「本服务签发、未过期」；用户是否被停用/改密/降级需中间件回查 users 表。
export async function verifySession(
  sessionSecret: string,
  token: string | undefined,
): Promise<SessionClaims | null> {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = b64urlEncode(await hmac(sessionSecret, payload));
  if (!timingSafeEqual(sig, expected)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
  } catch {
    return null; // 旧格式 cookie（仅 exp 数字串）或损坏 → 无效，需重新登录
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { uid, role, ver, exp } = parsed as Record<string, unknown>;
  if (typeof uid !== 'number' || typeof role !== 'string' || typeof ver !== 'number') {
    return null;
  }
  if (typeof exp !== 'number' || !Number.isFinite(exp) || Date.now() >= exp) return null;
  return { uid, role, ver };
}

// 会话 cookie 属性：HttpOnly + Secure + SameSite=Lax（见 design 安全章节）。
// Secure 需 HTTPS；Docker 本地 http 调试时浏览器不回传，需置于 TLS 反代之后。
export function sessionCookie(token: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readSessionCookie(req: Request): string | undefined {
  const header = req.headers.get('Cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE_NAME) return v.join('=');
  }
  return undefined;
}
