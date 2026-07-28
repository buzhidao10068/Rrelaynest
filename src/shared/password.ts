// 登录密码单向哈希：PBKDF2-SHA256（crypto.subtle，Workers 与 Node 20+ 通用）。
// 与 crypto.ts 的 AES-GCM 区分：AES-GCM 可逆，用于站点 token / 代理密码；
// 登录密码绝不可逆，必须单向哈希 + 每请求 verify。
//
// 存储格式： "pbkdf2$<iterations>$<salt_b64>$<hash_b64>"
//   迭代数存进串内 → 未来可平滑上调而不破坏旧哈希（verify 时按串内迭代数复算）。

const enc = new TextEncoder();

// 默认迭代次数（multiuser-plan 第二节评审定值 ≥ 100_000）。
const DEFAULT_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

function b64encode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// 恒定时间比较（对齐 auth.ts 的 timingSafeEqual），避免时序攻击。
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// PBKDF2-SHA256 派生，返回 base64 的 HASH_BYTES 字节。
async function derive(
  plain: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(plain),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    HASH_BYTES * 8,
  );
  return b64encode(new Uint8Array(bits));
}

// 哈希明文密码，返回可入库的存储串。
export async function hashPassword(
  plain: string,
  iterations: number = DEFAULT_ITERATIONS,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(SALT_BYTES)));
  const hash = await derive(plain, salt, iterations);
  return `pbkdf2$${iterations}$${b64encode(salt)}$${hash}`;
}

// 校验明文密码是否匹配存储串。按串内记录的迭代数复算 → 支持平滑上调迭代数。
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  let salt: Uint8Array<ArrayBuffer>;
  try {
    salt = b64decode(parts[2]);
  } catch {
    return false;
  }
  const expected = parts[3];
  const actual = await derive(plain, salt, iterations);
  return timingSafeEqual(actual, expected);
}
