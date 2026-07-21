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

// 从 base64 的 32 字节密钥导入 AES-GCM 密钥。
async function importAesKey(keyB64: string): Promise<CryptoKey> {
  const raw = b64decode(keyB64);
  if (raw.length !== 32) {
    throw new Error('ENCRYPTION_KEY 必须是 32 字节的 base64 字符串');
  }
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
