// version.ts 单测：语义版本比较 + GitHub Releases 代理（供 /api/update/check 判新版）。
import { test, expect } from 'vitest';
import { cmpVersion, fetchLatestRelease, upgradeSteps } from './version.js';
import type { FetchLike } from './types.js';

test('主版本比较', () => {
  expect(cmpVersion('v2.0.0', 'v1.0.0')).toBe(1);
  expect(cmpVersion('v1.0.0', 'v2.0.0')).toBe(-1);
});

test('次版本 / 补丁比较', () => {
  expect(cmpVersion('v1.2.0', 'v1.1.9')).toBe(1);
  expect(cmpVersion('v1.0.1', 'v1.0.2')).toBe(-1);
});

test('相等（含前缀 v 与无前缀混用）', () => {
  expect(cmpVersion('v1.2.3', '1.2.3')).toBe(0);
  expect(cmpVersion('1.0.0', 'v1.0.0')).toBe(0);
});

test('段数不齐：短的按 0 补齐', () => {
  expect(cmpVersion('v1.2', 'v1.2.0')).toBe(0);
  expect(cmpVersion('v1.2.1', 'v1.2')).toBe(1);
});

test('非数字段容错为 0', () => {
  expect(cmpVersion('v1.x.0', 'v1.0.0')).toBe(0);
  expect(cmpVersion('vabc', 'v0.0.0')).toBe(0);
});

test('前后空白容错', () => {
  expect(cmpVersion(' v1.2.0 ', 'v1.1.0')).toBe(1);
});

// ==== upgradeSteps ====

test('升级步骤按平台区分', () => {
  expect(upgradeSteps('workers')).toContain('npx wrangler deploy');
  expect(upgradeSteps('node')).toContain('docker compose up -d');
  // 未知平台回落 Node/Docker
  expect(upgradeSteps('anything')).toContain('docker compose up -d');
});

// ==== fetchLatestRelease（注入 fake fetch，不触真实网络）====

// 构造一个返回指定 JSON 的 fake fetch。
function fakeFetch(status: number, body: unknown): FetchLike {
  return async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
}

test('有新版：远端 tag 高于本地 → has_update=true，带 release 详情', async () => {
  const f = fakeFetch(200, {
    tag_name: 'v1.2.0',
    published_at: '2026-07-24T00:00:00Z',
    body: '- 新增功能',
    html_url: 'https://github.com/owner/repo/releases/tag/v1.2.0',
  });
  const res = await fetchLatestRelease('owner/repo', 'v1.0.0', 'node', f);
  expect(res.has_update).toBe(true);
  expect(res.current).toBe('v1.0.0');
  expect(res.latest?.tag_name).toBe('v1.2.0');
  expect(res.latest?.body).toBe('- 新增功能');
  expect(res.upgrade_steps).toContain('docker compose up -d');
  expect(res.error).toBeUndefined();
});

test('已是最新：远端 tag 等于本地 → has_update=false', async () => {
  const f = fakeFetch(200, { tag_name: 'v1.0.0', published_at: '', body: '', html_url: '' });
  const res = await fetchLatestRelease('owner/repo', 'v1.0.0', 'workers', f);
  expect(res.has_update).toBe(false);
  expect(res.latest?.tag_name).toBe('v1.0.0');
  expect(res.upgrade_steps).toContain('npx wrangler deploy');
});

test('本地版本更高（未发布的开发版）→ has_update=false', async () => {
  const f = fakeFetch(200, { tag_name: 'v1.0.0', published_at: '', body: '', html_url: '' });
  const res = await fetchLatestRelease('owner/repo', 'v1.5.0', 'node', f);
  expect(res.has_update).toBe(false);
});

test('GitHub 非 200（限流/404）→ 返回 error，不抛，has_update=false', async () => {
  const f = fakeFetch(403, { message: 'rate limited' });
  const res = await fetchLatestRelease('owner/repo', 'v1.0.0', 'node', f);
  expect(res.has_update).toBe(false);
  expect(res.latest).toBeNull();
  expect(res.error).toContain('HTTP 403');
  // 即便失败也给出升级步骤（前端可展示）。
  expect(res.upgrade_steps.length).toBeGreaterThan(0);
});

test('缺 tag_name → 返回 error', async () => {
  const f = fakeFetch(200, { published_at: '', body: '' });
  const res = await fetchLatestRelease('owner/repo', 'v1.0.0', 'node', f);
  expect(res.error).toContain('tag_name');
  expect(res.has_update).toBe(false);
});

test('fetch 抛异常（网络错误）→ 捕获为 error，不冒泡', async () => {
  const f: FetchLike = async () => {
    throw new Error('ECONNREFUSED');
  };
  const res = await fetchLatestRelease('owner/repo', 'v1.0.0', 'node', f);
  expect(res.error).toContain('ECONNREFUSED');
  expect(res.has_update).toBe(false);
});
