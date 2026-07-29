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

// ---- 两步验证（2FA）登录握手票 ----
// 密码验过、但该用户开了 TOTP 时，第一步不发会话，改发这张短时票（默认 5 分钟）。
// 第二步 /api/login/totp 拿票 + 验证码，验票通过才签发正式会话。
// 票绑定 uid + 签发时的 session_version 快照：两步之间若改密/停用（ver 变），票即失效。
// kind:'mfa' 标记 + 缺 role 字段 → 与会话 token 结构不同，二者无法互相冒用（verifySession 要求 role 为 string）。
const MFA_TICKET_TTL_MS = 5 * 60 * 1000; // 5 分钟

export interface MfaTicketClaims {
  uid: number;
  ver: number; // 签发时的 users.session_version 快照
}

export async function createMfaTicket(
  sessionSecret: string,
  uid: number,
  ver: number,
): Promise<string> {
  const claims = { kind: 'mfa', uid, ver, exp: Date.now() + MFA_TICKET_TTL_MS };
  const payload = b64urlEncode(enc.encode(JSON.stringify(claims)));
  const sig = b64urlEncode(await hmac(sessionSecret, payload));
  return `${payload}.${sig}`;
}

// 验票：验签 + 未过期 + kind==='mfa'。通过返回 {uid, ver}（还需回查库比对 ver / disabled）。
export async function verifyMfaTicket(
  sessionSecret: string,
  token: string | undefined,
): Promise<MfaTicketClaims | null> {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = b64urlEncode(await hmac(sessionSecret, payload));
  if (!timingSafeEqual(sig, expected)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { kind, uid, ver, exp } = parsed as Record<string, unknown>;
  if (kind !== 'mfa') return null; // 拒绝把会话 token 当票用
  if (typeof uid !== 'number' || typeof ver !== 'number') return null;
  if (typeof exp !== 'number' || !Number.isFinite(exp) || Date.now() >= exp) return null;
  return { uid, ver };
}

// ---- WebAuthn / Passkey 挑战短时票 ----
// WebAuthn 两步握手：服务端 generate*Options 产随机 challenge → 浏览器操作认证器 →
// 服务端 verify*Response 比对 challenge。challenge 需跨两请求留存，但 Workers isolate
// 不能靠进程内存 → 把 challenge 装进这张 HMAC 短时签名票（默认 5 分钟）发前端，验证时
// 验签+取回，服务端零状态。kind 区分用途：'reg'（已登录用户加 Passkey，绑 uid）/
// 'auth'（无密码登录，此刻还不知是谁，故不绑 uid，challenge 自身足够）。
// kind 隔离 + 与会话/ MFA 票结构不同（缺 role、kind 值不同）→ 无法互相冒用。
const CHALLENGE_TICKET_TTL_MS = 5 * 60 * 1000; // 5 分钟

export type ChallengeKind = 'reg' | 'auth';

export interface ChallengeTicketClaims {
  challenge: string; // base64url，generate*Options 返回的 options.challenge
  uid?: number; // 仅 'reg' 绑定（加 Passkey 的当前用户）；'auth' 无
}

export async function createChallengeTicket(
  sessionSecret: string,
  kind: ChallengeKind,
  challenge: string,
  uid?: number,
): Promise<string> {
  const claims: Record<string, unknown> = {
    ck: kind, // ck = challenge-kind，避免与 mfa 票的 kind 混淆语义
    challenge,
    exp: Date.now() + CHALLENGE_TICKET_TTL_MS,
  };
  if (typeof uid === 'number') claims.uid = uid;
  const payload = b64urlEncode(enc.encode(JSON.stringify(claims)));
  const sig = b64urlEncode(await hmac(sessionSecret, payload));
  return `${payload}.${sig}`;
}

// 验票：验签 + 未过期 + ck===期望 kind。通过返回 {challenge, uid?}，否则 null。
// 传入 expectKind 强制用途隔离：注册票不能拿去当认证票用（反之亦然）。
export async function verifyChallengeTicket(
  sessionSecret: string,
  token: string | undefined,
  expectKind: ChallengeKind,
): Promise<ChallengeTicketClaims | null> {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = b64urlEncode(await hmac(sessionSecret, payload));
  if (!timingSafeEqual(sig, expected)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { ck, challenge, uid, exp } = parsed as Record<string, unknown>;
  if (ck !== expectKind) return null; // 用途隔离：拒绝跨 kind 使用
  if (typeof challenge !== 'string' || !challenge) return null;
  if (typeof exp !== 'number' || !Number.isFinite(exp) || Date.now() >= exp) return null;
  const out: ChallengeTicketClaims = { challenge };
  if (typeof uid === 'number') out.uid = uid;
  return out;
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
