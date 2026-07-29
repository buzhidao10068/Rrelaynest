// TOTP（RFC 6238）+ base32 + otpauth URI，纯逻辑、平台无关（crypto.subtle，Workers 与 Node 20+ 通用）。
// 两步验证的第二因子：与主流验证器 App（Google Authenticator / 1Password / Authy）互通。
// 参数固定为业界事实标准：HMAC-SHA1 / 6 位 / 30 秒周期——RFC 6238 用 SHA-1，验证器默认也是 SHA-1。
// 正确性由 totp.test.ts 的 RFC 6238 官方测试向量锁定；密钥的加密存储在 crypto.ts（AES-GCM）。

const RFC4648_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// ---- base32（RFC 4648，无 padding 输出）----

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += RFC4648_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += RFC4648_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

// 解码大小写不敏感，忽略空格与 '=' padding。遇非法字符抛错（调用方应喂合法 base32）。
export function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = RFC4648_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('非法 base32 字符');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

// ---- HOTP / TOTP（RFC 4226 / 6238）----

// 8 字节大端计数器（time step）。
function counterBytes(counter: number): Uint8Array {
  const buf = new Uint8Array(8);
  // counter 可能超过 32 位，用 BigInt 安全写入。
  let n = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    buf[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return buf;
}

async function hmacSha1(keyBytes: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as Uint8Array<ArrayBuffer>,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, msg as Uint8Array<ArrayBuffer>);
  return new Uint8Array(sig);
}

// RFC 4226 动态截断：取 HMAC 末字节低 4 位为偏移，读 4 字节 → 31 位整数 → 取末 digits 位、左补零。
function truncate(hmac: Uint8Array, digits: number): string {
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const mod = bin % 10 ** digits;
  return String(mod).padStart(digits, '0');
}

interface TotpOpts {
  nowMs?: number; // 当前时间（毫秒），缺省 Date.now()。测试注入 RFC 向量用。
  digits?: number; // 码位数，缺省 6。
  periodSec?: number; // 时间步长（秒），缺省 30。
}

// 生成指定时刻的 TOTP 码。
export async function generateTotp(secretB32: string, opts: TotpOpts = {}): Promise<string> {
  const nowMs = opts.nowMs ?? Date.now();
  const digits = opts.digits ?? 6;
  const periodSec = opts.periodSec ?? 30;
  const counter = Math.floor(nowMs / 1000 / periodSec);
  const key = base32Decode(secretB32);
  const hmac = await hmacSha1(key, counterBytes(counter));
  return truncate(hmac, digits);
}

interface VerifyOpts extends TotpOpts {
  window?: number; // 前后各容忍多少个时间步长，缺省 1（±30s，抗时钟偏移）。
}

// 校验用户输入的码是否匹配 ±window 个时间步长内的任一 TOTP。恒定时间比较避免时序泄漏。
// 输入非法（空/非数字/长度不符）直接判否，不抛。
export async function verifyTotp(secretB32: string, code: string, opts: VerifyOpts = {}): Promise<boolean> {
  const digits = opts.digits ?? 6;
  if (!code || !new RegExp(`^\\d{${digits}}$`).test(code)) return false;
  const nowMs = opts.nowMs ?? Date.now();
  const periodSec = opts.periodSec ?? 30;
  const window = opts.window ?? 1;
  let ok = false;
  for (let w = -window; w <= window; w++) {
    const candidate = await generateTotp(secretB32, {
      nowMs: nowMs + w * periodSec * 1000,
      digits,
      periodSec,
    });
    // 不短路，遍历全窗口做恒定时间比较，避免按匹配位置泄漏时序。
    if (timingSafeEqualStr(candidate, code)) ok = true;
  }
  return ok;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- 密钥生成 / otpauth URI ----

// 生成随机 base32 密钥（默认 20 字节 = 160 位，RFC 4226 推荐下限，编码后 32 字符）。
export function randomBase32Secret(bytes = 20): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes));
  return base32Encode(raw);
}

interface OtpauthParams {
  secret: string; // base32
  account: string; // 用户名/邮箱，显示在验证器里
  issuer: string; // 服务名
}

// 生成验证器可扫描的 otpauth://totp URI（Key Uri Format）。
// label = "issuer:account"，冒号保留字面量（可读、广泛兼容），issuer/account 分段编码。
// 查询参数手工用 encodeURIComponent（空格 → %20，而非 URLSearchParams 的 '+'——部分验证器不认 '+'）。
export function buildOtpauthUri({ secret, account, issuer }: OtpauthParams): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = [
    `secret=${encodeURIComponent(secret)}`,
    `issuer=${encodeURIComponent(issuer)}`,
    'algorithm=SHA1',
    'digits=6',
    'period=30',
  ].join('&');
  return `otpauth://totp/${label}?${params}`;
}
