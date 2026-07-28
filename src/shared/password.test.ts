// password.ts 单测。用 Node 内置 test runner（node:test），零新依赖。
// 运行：node --test src/shared/password.test.ts （Node 22+ 原生剥离 TS 类型）。
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './password.js';

test('hashPassword 产出 pbkdf2$iter$salt$hash 四段格式', async () => {
  const stored = await hashPassword('correct horse battery staple');
  const parts = stored.split('$');
  assert.equal(parts.length, 4);
  assert.equal(parts[0], 'pbkdf2');
  assert.equal(Number(parts[1]), 100_000);
  assert.ok(parts[2].length > 0, 'salt 非空');
  assert.ok(parts[3].length > 0, 'hash 非空');
});

test('同一密码两次哈希盐不同 → 存储串不同（防彩虹表）', async () => {
  const a = await hashPassword('same-password');
  const b = await hashPassword('same-password');
  assert.notEqual(a, b);
});

test('verifyPassword 正确密码返回 true', async () => {
  const stored = await hashPassword('s3cret!');
  assert.equal(await verifyPassword('s3cret!', stored), true);
});

test('verifyPassword 错误密码返回 false', async () => {
  const stored = await hashPassword('s3cret!');
  assert.equal(await verifyPassword('wrong', stored), false);
});

test('verifyPassword 空密码/空存储串返回 false', async () => {
  const stored = await hashPassword('x');
  assert.equal(await verifyPassword('', stored), false);
  assert.equal(await verifyPassword('x', ''), false);
});

test('verifyPassword 格式非法（非 pbkdf2 前缀/段数不对/坏 base64/坏迭代数）返回 false', async () => {
  assert.equal(await verifyPassword('x', 'plaintext'), false);
  assert.equal(await verifyPassword('x', 'bcrypt$10$abc$def'), false);
  assert.equal(await verifyPassword('x', 'pbkdf2$100000$onlythree'), false);
  assert.equal(await verifyPassword('x', 'pbkdf2$abc$c2FsdA==$aGFzaA=='), false);
  assert.equal(await verifyPassword('x', 'pbkdf2$0$c2FsdA==$aGFzaA=='), false);
});

test('verifyPassword 按串内迭代数复算 → 支持平滑上调迭代数', async () => {
  // 用较低迭代数存储，仍能被验证（模拟历史哈希）。
  const stored = await hashPassword('legacy', 50_000);
  assert.equal(stored.split('$')[1], '50000');
  assert.equal(await verifyPassword('legacy', stored), true);
});

test('哈希支持 unicode 密码', async () => {
  const stored = await hashPassword('密码🔑パスワード');
  assert.equal(await verifyPassword('密码🔑パスワード', stored), true);
  assert.equal(await verifyPassword('密码🔑', stored), false);
});
