// 外部 cron 触发端点的隔离测试：不碰 DB，把 run 换成计数器，只验「谁能触发、触发了几次」。
import { test, expect } from 'vitest';
import { handleCronTick, CRON_TICK_PATH, CRON_TICK_HEADER } from './cron-tick.js';

const SECRET = 'test-cron-secret';
const URL_ = `https://example.com${CRON_TICK_PATH}`;

/** 记录 run 被调次数，并可指定让它 reject。 */
function spyRun(opts: { fail?: boolean } = {}) {
  const calls: number[] = [];
  return {
    calls,
    run: async () => {
      calls.push(Date.now());
      if (opts.fail) throw new Error('boom');
    },
  };
}

function post(headers: Record<string, string> = {}): Request {
  return new Request(URL_, { method: 'POST', headers });
}

test('带正确密钥的 POST 返回 202 并执行 tick', async () => {
  const spy = spyRun();
  const res = await handleCronTick(post({ [CRON_TICK_HEADER]: SECRET }), {
    secret: SECRET,
    run: spy.run,
  });
  expect(res.status).toBe(202);
  expect(spy.calls.length).toBe(1);
});

test('密钥错误返回 403 且不执行 tick', async () => {
  const spy = spyRun();
  const res = await handleCronTick(post({ [CRON_TICK_HEADER]: 'wrong-secret-x' }), {
    secret: SECRET,
    run: spy.run,
  });
  expect(res.status).toBe(403);
  expect(spy.calls.length).toBe(0);
});

test('缺请求头返回 403 且不执行 tick', async () => {
  const spy = spyRun();
  const res = await handleCronTick(post(), { secret: SECRET, run: spy.run });
  expect(res.status).toBe(403);
  expect(spy.calls.length).toBe(0);
});

// 长度不同曾是 timingSafeEqual 的提前返回分支，单独钉一条防回归。
test('密钥长度不同也返回 403', async () => {
  const spy = spyRun();
  const res = await handleCronTick(post({ [CRON_TICK_HEADER]: SECRET + 'extra' }), {
    secret: SECRET,
    run: spy.run,
  });
  expect(res.status).toBe(403);
  expect(spy.calls.length).toBe(0);
});

test('本端未配置 CRON_SECRET 时返回 503，与 403 区分开', async () => {
  const spy = spyRun();
  const res = await handleCronTick(post({ [CRON_TICK_HEADER]: SECRET }), {
    secret: undefined,
    run: spy.run,
  });
  expect(res.status).toBe(503);
  expect(spy.calls.length).toBe(0);
});

// 空字符串密钥同样算未配置：否则「不带请求头」会因为 null 拿不到而 403，
// 而「带空请求头」反倒可能匹配上，成了无密钥可触发的后门。
test('CRON_SECRET 为空字符串按未配置处理', async () => {
  const spy = spyRun();
  const res = await handleCronTick(post({ [CRON_TICK_HEADER]: '' }), { secret: '', run: spy.run });
  expect(res.status).toBe(503);
  expect(spy.calls.length).toBe(0);
});

test('GET 返回 405 且不执行 tick', async () => {
  const spy = spyRun();
  const res = await handleCronTick(new Request(URL_, { method: 'GET' }), {
    secret: SECRET,
    run: spy.run,
  });
  expect(res.status).toBe(405);
  expect(res.headers.get('Allow')).toBe('POST');
  expect(spy.calls.length).toBe(0);
});

// 方法校验必须排在密钥校验之前，否则 405 会泄露「密钥对不对」。
test('GET 即使带正确密钥也是 405', async () => {
  const spy = spyRun();
  const res = await handleCronTick(new Request(URL_, { method: 'GET', headers: { [CRON_TICK_HEADER]: SECRET } }), {
    secret: SECRET,
    run: spy.run,
  });
  expect(res.status).toBe(405);
  expect(spy.calls.length).toBe(0);
});

test('tick 抛错时仍返回 202，错误被吞进日志', async () => {
  const spy = spyRun({ fail: true });
  const res = await handleCronTick(post({ [CRON_TICK_HEADER]: SECRET }), {
    secret: SECRET,
    run: spy.run,
  });
  expect(res.status).toBe(202);
  expect(spy.calls.length).toBe(1);
});

test('给了 waitUntil 就交给它后台跑，响应不等 tick 完成', async () => {
  let resolveRun: (() => void) | undefined;
  let finished = false;
  const pending: Promise<unknown>[] = [];
  const res = await handleCronTick(post({ [CRON_TICK_HEADER]: SECRET }), {
    secret: SECRET,
    run: () =>
      new Promise<void>((resolve) => {
        resolveRun = () => {
          finished = true;
          resolve();
        };
      }),
    waitUntil: (p) => pending.push(p),
  });
  expect(res.status).toBe(202);
  expect(pending.length).toBe(1);
  expect(finished).toBe(false); // 关键：tick 还没跑完，202 已经回去了
  resolveRun?.();
  await pending[0];
  expect(finished).toBe(true);
});

// waitUntil 拿到的 promise 必须已经被 catch 过，否则 Workers 侧会冒出无上下文的未捕获拒绝。
test('waitUntil 收到的 promise 不会 reject', async () => {
  const pending: Promise<unknown>[] = [];
  await handleCronTick(post({ [CRON_TICK_HEADER]: SECRET }), {
    secret: SECRET,
    run: async () => {
      throw new Error('boom');
    },
    waitUntil: (p) => pending.push(p),
  });
  await expect(pending[0]).resolves.toBeUndefined();
});

test('没给 waitUntil 时等 tick 跑完才返回', async () => {
  let finished = false;
  const res = await handleCronTick(post({ [CRON_TICK_HEADER]: SECRET }), {
    secret: SECRET,
    run: async () => {
      await Promise.resolve();
      finished = true;
    },
  });
  expect(res.status).toBe(202);
  expect(finished).toBe(true);
});
