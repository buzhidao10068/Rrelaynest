// AES-GCM 加解密站点 access token。基于 Web Crypto API（crypto.subtle）。
// Workers 原生支持；Node 20+ 通过全局 crypto 原生支持，无需分叉（见 TD2）。
// 会话 cookie 的签名逻辑在 auth.ts，与此处解耦。

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ---- ENCRYPTION_KEY 格式契约（单一真相源）----
// AES-GCM 要求 32 字节密钥，故 ENCRYPTION_KEY 必须是「base64 编码的 32 字节」= 44 字符、末尾带 '='。
// 历史坑：文档曾让用户用 `openssl rand -hex 32` 生成，产出 64 字符 hex 串。hex 字符（0-9a-f）
// 全落在 base64 字符集内，atob 不会抛格式错，只会静默解出 48 字节 —— 于是坏密钥一路混到
// 用户保存 token 那一刻才炸成裸 500。所以这里必须显式校验字节数，并在文案里点名 hex 这个错法。
// 注意 SESSION_SECRET 无此约束（auth.ts 走 enc.encode() 喂 HMAC，任意长度合法），两者不可一刀切。

export interface KeyCheckResult {
  ok: boolean;
  reason?: 'empty' | 'not_base64' | 'wrong_length';
  actualBytes?: number; // 仅 wrong_length 时给出，便于用户对照（不含密钥内容）
}

// 不抛异常的纯判定：与加密路径共用同一套规则，避免两处规则漂移。
// 安全红线：返回值只有原因枚举 + 字节数，绝不回显密钥内容或任何片段。
export function checkEncryptionKey(keyB64: string): KeyCheckResult {
  if (!keyB64 || !keyB64.trim()) return { ok: false, reason: 'empty' };
  let raw: Uint8Array;
  try {
    raw = b64decode(keyB64.trim());
  } catch {
    // base64 字符集外的字符，或长度不成 4 的倍数
    return { ok: false, reason: 'not_base64' };
  }
  if (raw.length !== 32) return { ok: false, reason: 'wrong_length', actualBytes: raw.length };
  return { ok: true };
}

const GEN_HINT = '请用 `openssl rand -base64 32` 重新生成（应为 44 字符、末尾带 =）';

// 把判定结果转成给人看的文案。同样不含密钥内容，只说格式与生成命令。
// 文案只有这一处定义：importAesKey、两个平台入口、路由错误响应全部复用它。
export function encryptionKeyErrorMessage(res: KeyCheckResult): string {
  if (res.ok) return '';
  if (res.reason === 'empty') return `ENCRYPTION_KEY 未配置。${GEN_HINT}`;
  if (res.reason === 'not_base64') return `ENCRYPTION_KEY 不是合法的 base64 字符串。${GEN_HINT}`;
  const n = res.actualBytes ?? 0;
  // 48 字节几乎必然是 64 字符 hex 串（旧文档教的 `openssl rand -hex 32`），直接点名，
  // 否则用户看到「长度不对」仍然一头雾水。
  const hexHint = n === 48 ? '（看起来是 64 字符的十六进制串，那是旧文档的错误示例）' : '';
  return `ENCRYPTION_KEY 必须是 base64 编码的 32 字节，当前解码得 ${n} 字节${hexHint}。${GEN_HINT}`;
}

// 从 base64 的 32 字节密钥导入 AES-GCM 密钥。
async function importAesKey(keyB64: string): Promise<CryptoKey> {
  const check = checkEncryptionKey(keyB64);
  if (!check.ok) throw new Error(encryptionKeyErrorMessage(check));
  const raw = b64decode(keyB64.trim());
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// 加密明文 token，返回 base64(iv):base64(ciphertext)。
export async function encryptToken(encryptionKey: string, plain: string): Promise<string> {
  const key = await importAesKey(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain));
  return `${b64encode(iv)}:${b64encode(ct)}`;
}

// 解密 encryptToken 的输出。
export async function decryptToken(encryptionKey: string, stored: string): Promise<string> {
  const [ivB64, ctB64] = stored.split(':');
  if (!ivB64 || !ctB64) throw new Error('token 密文格式错误');
  const key = await importAesKey(encryptionKey);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64decode(ivB64) },
    key,
    b64decode(ctB64),
  );
  return dec.decode(pt);
}
