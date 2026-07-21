// 登录鉴权：密码校验 + 签名会话 cookie（HMAC-SHA256，无需数据库存 session）。
// 基于 Web Crypto（crypto.subtle），Workers 与 Node 20+ 通用（见 TD2）。

const COOKIE_NAME = 'rn_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

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

// 恒定时间比较，避免时序攻击。
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// 生成会话 token：payload 为过期时间戳，附 HMAC 签名。
export async function createSession(sessionSecret: string): Promise<string> {
  const exp = String(Date.now() + SESSION_TTL_MS);
  const payload = b64urlEncode(enc.encode(exp));
  const sig = b64urlEncode(await hmac(sessionSecret, payload));
  return `${payload}.${sig}`;
}

export async function verifySession(
  sessionSecret: string,
  token: string | undefined,
): Promise<boolean> {
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = b64urlEncode(await hmac(sessionSecret, payload));
  if (!timingSafeEqual(sig, expected)) return false;
  const exp = Number(new TextDecoder().decode(b64urlDecode(payload)));
  return Number.isFinite(exp) && Date.now() < exp;
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

export function verifyPassword(adminPassword: string, password: string): boolean {
  if (!adminPassword) return false;
  return timingSafeEqual(password, adminPassword);
}
