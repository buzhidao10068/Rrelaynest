// TOTP（RFC 6238）核心逻辑测试。correctness-critical：用 RFC 6238 附录 B 的官方测试向量锁定实现，
// 保证与主流验证器 App（Google Authenticator / 1Password / Authy 等）互通。
// RFC 6238 的测试向量用 SHA-1、8 位码；主流验证器实际用 6 位——两者取同一 HOTP 值的末 N 位，
// 故用 8 位向量验证「HOTP 计算正确」，再单独测 6 位截断（截 8 位向量的末 6 位）。
import { test, expect } from 'vitest';
import {
  base32Encode,
  base32Decode,
  generateTotp,
  verifyTotp,
  randomBase32Secret,
  buildOtpauthUri,
} from './totp.js';

// RFC 6238 附录 B 的共享密钥（ASCII "12345678901234567890"）与其 base32 形式。
const RFC_SECRET_ASCII = '12345678901234567890';
const RFC_SECRET_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // 20 字节 → 32 个 base32 字符

// RFC 6238 附录 B 表格（SHA-1，T0=0，X=30s，8 位码）。选取时间戳 → 期望 8 位码。
const RFC_VECTORS: Array<{ time: number; totp8: string }> = [
  { time: 59, totp8: '94287082' },
  { time: 1111111109, totp8: '07081804' },
  { time: 1111111111, totp8: '14050471' },
  { time: 1234567890, totp8: '89005924' },
  { time: 2000000000, totp8: '69279037' },
  { time: 20000000000, totp8: '65353130' },
];

// ---- base32 编解码 ----

test('base32：ASCII 密钥编码为 RFC 期望的 base32', () => {
  const bytes = new TextEncoder().encode(RFC_SECRET_ASCII);
  expect(base32Encode(bytes)).toBe(RFC_SECRET_B32);
});

test('base32：解码是编码的逆，round-trip 还原原字节', () => {
  const original = new TextEncoder().encode(RFC_SECRET_ASCII);
  const decoded = base32Decode(RFC_SECRET_B32);
  expect(Array.from(decoded)).toEqual(Array.from(original));
});

test('base32：解码大小写不敏感、忽略空格与 padding', () => {
  const a = base32Decode(RFC_SECRET_B32.toLowerCase());
  const b = base32Decode(RFC_SECRET_B32);
  expect(Array.from(a)).toEqual(Array.from(b));
  // 带空格与 = padding 也应正常
  const c = base32Decode('GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ====');
  expect(Array.from(c)).toEqual(Array.from(b));
});

// ---- RFC 6238 官方向量：HOTP 计算正确性 ----

for (const v of RFC_VECTORS) {
  test(`RFC 6238 向量 t=${v.time}：8 位码 = ${v.totp8}`, async () => {
    const code = await generateTotp(RFC_SECRET_B32, { nowMs: v.time * 1000, digits: 8 });
    expect(code).toBe(v.totp8);
  });
}

test('6 位码 = 对应 8 位向量的末 6 位（截断一致性）', async () => {
  for (const v of RFC_VECTORS) {
    const code6 = await generateTotp(RFC_SECRET_B32, { nowMs: v.time * 1000, digits: 6 });
    expect(code6).toBe(v.totp8.slice(-6));
  }
});

// ---- verifyTotp：时窗容错 ----

test('verifyTotp：当前时窗的码通过', async () => {
  const now = 1111111109 * 1000;
  const code = await generateTotp(RFC_SECRET_B32, { nowMs: now, digits: 6 });
  expect(await verifyTotp(RFC_SECRET_B32, code, { nowMs: now })).toBe(true);
});

test('verifyTotp：±1 时窗（时钟偏移）内的码也通过', async () => {
  const now = 1111111109 * 1000;
  const prev = await generateTotp(RFC_SECRET_B32, { nowMs: now - 30_000, digits: 6 });
  const next = await generateTotp(RFC_SECRET_B32, { nowMs: now + 30_000, digits: 6 });
  expect(await verifyTotp(RFC_SECRET_B32, prev, { nowMs: now })).toBe(true);
  expect(await verifyTotp(RFC_SECRET_B32, next, { nowMs: now })).toBe(true);
});

test('verifyTotp：±2 时窗外的码被拒（默认窗口=1）', async () => {
  const now = 1111111109 * 1000;
  const far = await generateTotp(RFC_SECRET_B32, { nowMs: now + 90_000, digits: 6 });
  expect(await verifyTotp(RFC_SECRET_B32, far, { nowMs: now })).toBe(false);
});

test('verifyTotp：错误的码被拒', async () => {
  const now = 1111111109 * 1000;
  expect(await verifyTotp(RFC_SECRET_B32, '000000', { nowMs: now })).toBe(false);
});

test('verifyTotp：非 6 位数字（空/字母/长度错）被拒，不抛异常', async () => {
  const now = Date.now();
  expect(await verifyTotp(RFC_SECRET_B32, '', { nowMs: now })).toBe(false);
  expect(await verifyTotp(RFC_SECRET_B32, 'abcdef', { nowMs: now })).toBe(false);
  expect(await verifyTotp(RFC_SECRET_B32, '12345', { nowMs: now })).toBe(false);
  expect(await verifyTotp(RFC_SECRET_B32, '1234567', { nowMs: now })).toBe(false);
});

// ---- randomBase32Secret ----

test('randomBase32Secret：生成合法 base32、长度足够、每次不同', () => {
  const a = randomBase32Secret();
  const b = randomBase32Secret();
  expect(a).not.toBe(b);
  expect(a).toMatch(/^[A-Z2-7]+$/); // 合法 base32 字母表，无 padding
  expect(a.length).toBeGreaterThanOrEqual(32); // ≥ 20 字节
  // 生成的密钥能被解码且能算出码（自洽）
  expect(() => base32Decode(a)).not.toThrow();
});

// ---- buildOtpauthUri ----

test('buildOtpauthUri：符合 otpauth://totp 格式，含 issuer/account/secret', () => {
  const uri = buildOtpauthUri({ secret: RFC_SECRET_B32, account: 'alice', issuer: 'Rrelaynest' });
  expect(uri.startsWith('otpauth://totp/')).toBe(true);
  expect(uri).toContain('Rrelaynest:alice');
  expect(uri).toContain(`secret=${RFC_SECRET_B32}`);
  expect(uri).toContain('issuer=Rrelaynest');
  expect(uri).toContain('algorithm=SHA1');
  expect(uri).toContain('digits=6');
  expect(uri).toContain('period=30');
});

test('buildOtpauthUri：account 含特殊字符时被 URL 编码', () => {
  const uri = buildOtpauthUri({ secret: RFC_SECRET_B32, account: 'a b@c', issuer: 'R N' });
  expect(uri).not.toContain('a b@c'); // 原始空格/@ 不应裸露在 label 里
  expect(uri).toContain('issuer=R%20N');
});
