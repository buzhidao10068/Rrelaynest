// ENCRYPTION_KEY 格式契约与 AES-GCM 往返测试。
// 本文件的核心是回归锚点：`openssl rand -hex 32` 产出的 64 字符 hex 串必须被判成
// wrong_length / 48 字节 —— 历史上正是这个「atob 不抛错、静默解出 48 字节」的行为，
// 让坏密钥一路混到用户保存 token 时才炸成裸 HTTP 500。
import { test, expect } from 'vitest';
import {
  checkEncryptionKey,
  encryptionKeyErrorMessage,
  encryptToken,
  decryptToken,
} from './crypto.js';

// 合法密钥：base64 编码的 32 字节（44 字符、末尾带 =）。
const VALID_KEY = btoa(String.fromCharCode(...new Uint8Array(32)));
// 旧文档教的坏密钥形态：`openssl rand -hex 32` = 64 字符十六进制串。
const HEX_KEY = 'a'.repeat(64);

// ---- checkEncryptionKey 判定规则 ----

test('合法密钥（base64 32 字节 = 44 字符）判定通过', () => {
  expect(VALID_KEY.length).toBe(44);
  expect(VALID_KEY.endsWith('=')).toBe(true);
  expect(checkEncryptionKey(VALID_KEY)).toEqual({ ok: true });
});

test('随机内容的合法密钥同样通过（不只对全零生效）', () => {
  const random = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  expect(checkEncryptionKey(random).ok).toBe(true);
});

test('末尾带换行的合法密钥仍通过（面板复制粘贴常见）', () => {
  expect(checkEncryptionKey(`${VALID_KEY}\n`).ok).toBe(true);
});

test('空串与全空白判为 empty', () => {
  expect(checkEncryptionKey('')).toEqual({ ok: false, reason: 'empty' });
  expect(checkEncryptionKey('   ')).toEqual({ ok: false, reason: 'empty' });
});

test('含 base64 字符集外字符判为 not_base64', () => {
  expect(checkEncryptionKey('not base64!!')).toEqual({ ok: false, reason: 'not_base64' });
  // 长度不成 4 的倍数（余 1）也解不出来
  expect(checkEncryptionKey('a')).toEqual({ ok: false, reason: 'not_base64' });
});

test('回归锚点：64 字符 hex 串判为 wrong_length 且实际 48 字节', () => {
  // hex 字符全在 base64 字符集内，atob 不抛错 —— 这正是坏密钥能混过启动的原因。
  expect(checkEncryptionKey(HEX_KEY)).toEqual({ ok: false, reason: 'wrong_length', actualBytes: 48 });
});

test('长度不对的其他 base64 判为 wrong_length 并带实际字节数', () => {
  const short = btoa(String.fromCharCode(...new Uint8Array(16))); // 16 字节
  expect(checkEncryptionKey(short)).toEqual({ ok: false, reason: 'wrong_length', actualBytes: 16 });
});

// ---- 错误文案 ----

test('48 字节的文案显式点名 hex 这个最常见错法，并给出生成命令', () => {
  const msg = encryptionKeyErrorMessage(checkEncryptionKey(HEX_KEY));
  expect(msg).toContain('48 字节');
  expect(msg).toContain('十六进制');
  expect(msg).toContain('openssl rand -base64 32');
});

test('三类 reason 的文案都给出生成命令，且合法时为空串', () => {
  for (const bad of ['', 'not base64!!', HEX_KEY]) {
    expect(encryptionKeyErrorMessage(checkEncryptionKey(bad))).toContain('openssl rand -base64 32');
  }
  expect(encryptionKeyErrorMessage(checkEncryptionKey(VALID_KEY))).toBe('');
});

test('文案绝不回显密钥内容或片段（安全红线）', () => {
  // 用一串可识别的坏密钥，断言文案里不出现它的任何片段。
  const secretish = btoa('SUPERSECRETKEYMATERIAL-do-not-leak');
  const msg = encryptionKeyErrorMessage(checkEncryptionKey(secretish));
  expect(msg).not.toContain(secretish);
  expect(msg).not.toContain('SUPERSECRET');
  expect(msg).not.toContain(secretish.slice(0, 8));
});

// ---- 加解密往返 ----

test('encryptToken / decryptToken 往返一致，密文形如 base64(iv):base64(ct)', async () => {
  const stored = await encryptToken(VALID_KEY, 'sk-test-token-123');
  expect(stored.split(':').length).toBe(2);
  expect(stored).not.toContain('sk-test-token-123'); // 不是明文存的
  expect(await decryptToken(VALID_KEY, stored)).toBe('sk-test-token-123');
});

test('同一明文两次加密的密文不同（随机 iv）', async () => {
  const a = await encryptToken(VALID_KEY, 'same-plain');
  const b = await encryptToken(VALID_KEY, 'same-plain');
  expect(a).not.toBe(b);
  expect(await decryptToken(VALID_KEY, a)).toBe('same-plain');
  expect(await decryptToken(VALID_KEY, b)).toBe('same-plain');
});

test('坏密钥下 encryptToken 抛出的错误文案可诊断，且不含密钥内容', async () => {
  await expect(encryptToken(HEX_KEY, 'whatever')).rejects.toThrow('openssl rand -base64 32');
  await expect(encryptToken(HEX_KEY, 'whatever')).rejects.toThrow('48 字节');
  const err = await encryptToken(HEX_KEY, 'whatever').catch((e: unknown) => e);
  expect(String(err)).not.toContain(HEX_KEY);
});

test('坏密钥下 decryptToken 同样抛可诊断错误', async () => {
  const stored = await encryptToken(VALID_KEY, 'x');
  await expect(decryptToken(HEX_KEY, stored)).rejects.toThrow('openssl rand -base64 32');
});

test('密文格式错误单独报错（与密钥问题区分）', async () => {
  await expect(decryptToken(VALID_KEY, 'no-colon-here')).rejects.toThrow('token 密文格式错误');
});
