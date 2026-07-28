// concurrency.ts 单测：受限并发 mapWithConcurrency + 退避重试 retryAsync。
// 纯函数、无 DB、无网络，只用计时与计数验证并发窗口与重试次数。
import { test, expect } from 'vitest';
import { mapWithConcurrency, retryAsync } from './concurrency.js';

test('mapWithConcurrency 保持等长同序结果', async () => {
  const items = [1, 2, 3, 4, 5];
  const out = await mapWithConcurrency(items, 2, async (x) => x * 10);
  expect(out).toEqual([10, 20, 30, 40, 50]);
});

test('mapWithConcurrency 空数组 → 空结果，不调 mapper', async () => {
  let called = 0;
  const out = await mapWithConcurrency([], 3, async (x) => {
    called++;
    return x;
  });
  expect(out).toEqual([]);
  expect(called).toBe(0);
});

test('mapWithConcurrency 并发窗口不超过 limit', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = Array.from({ length: 10 }, (_, i) => i);
  await mapWithConcurrency(items, 3, async (x) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    // 让出事件循环，制造真实并发重叠
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return x;
  });
  expect(maxInFlight).toBeLessThanOrEqual(3);
  expect(maxInFlight).toBeGreaterThan(1); // 确实并发了（不是退化成串行）
});

test('mapWithConcurrency limit<=0 时夹到 1（串行）', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  await mapWithConcurrency([1, 2, 3], 0, async (x) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 2));
    inFlight--;
    return x;
  });
  expect(maxInFlight).toBe(1);
});

test('retryAsync 首次成功不重试', async () => {
  let calls = 0;
  const r = await retryAsync(
    async () => {
      calls++;
      return 'ok';
    },
    { retries: 3, baseDelayMs: 1 },
  );
  expect(r).toBe('ok');
  expect(calls).toBe(1);
});

test('retryAsync 失败后重试直到成功（共 retries+1 次上限内）', async () => {
  let calls = 0;
  const r = await retryAsync(
    async () => {
      calls++;
      if (calls < 3) throw new Error('boom');
      return 'recovered';
    },
    { retries: 3, baseDelayMs: 1 },
  );
  expect(r).toBe('recovered');
  expect(calls).toBe(3); // 前两次失败，第三次成功
});

test('retryAsync 全失败抛最后一次异常，尝试次数 = retries+1', async () => {
  let calls = 0;
  await expect(
    retryAsync(
      async () => {
        calls++;
        throw new Error(`fail-${calls}`);
      },
      { retries: 2, baseDelayMs: 1 },
    ),
  ).rejects.toThrow('fail-3');
  expect(calls).toBe(3); // 1 次初试 + 2 次重试
});

test('retryAsync retries<=0 只跑一次', async () => {
  let calls = 0;
  await expect(
    retryAsync(
      async () => {
        calls++;
        throw new Error('x');
      },
      { retries: 0, baseDelayMs: 1 },
    ),
  ).rejects.toThrow('x');
  expect(calls).toBe(1);
});

test('retryAsync shouldRetry 返回 false 时立即放弃', async () => {
  let calls = 0;
  await expect(
    retryAsync(
      async () => {
        calls++;
        throw new Error('nonretryable');
      },
      { retries: 5, baseDelayMs: 1, shouldRetry: () => false },
    ),
  ).rejects.toThrow('nonretryable');
  expect(calls).toBe(1); // shouldRetry=false → 不重试
});
