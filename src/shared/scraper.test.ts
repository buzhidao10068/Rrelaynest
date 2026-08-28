// checkinSite 的签到结果判定测试。
//
// fixture 的 body 全部取自**线上真实站点的实测响应**（2026-08-28，在本地 Docker 调试
// 环境里用真实 token 打出来的），不是理想化构造——见 spec backend/testing.md
// 「fixtures that encode the ideal input」那条：上一次 149 测全绿却漏掉跨层 bug，
// 根因就是 fixture 只覆盖「后端收到合法输入会怎样」这个从不存疑的问题。
//
// 三种真实形状：
//  - aigc789.top（佩奇 API）：HTTP 200 + {"message":"Turnstile token 为空","success":false}
//  - api.aizzz.xyz：        HTTP 200 + {"message":"签到功能未启用","success":false}
//  - astu.online：          HTTP 404 + text/plain "404 page not found"（该站已换面板软件，非 new-api）
import { describe, expect, test } from 'vitest';
import { checkinSite } from './scraper.js';
import type { FetchLike } from './types.js';

// 造一个只回固定响应的假 fetch，并记录它收到的 URL/方法，用于断言请求形状。
// init 在 FetchLike 里是 unknown，故取 method 时先窄化，不用 any。
function fakeFetch(
  status: number,
  body: string,
  seen?: { url?: string; method?: string },
): FetchLike {
  return async (url, init) => {
    if (seen) {
      seen.url = String(url);
      const m = (init as { method?: unknown } | undefined)?.method;
      seen.method = typeof m === 'string' ? m : undefined;
    }
    return new Response(body, { status });
  };
}

const TOKEN = 'sk-test-token';

describe('checkinSite 人机验证识别', () => {
  test('HTTP 200 + Turnstile 文案 → needsManual（真实形状：aigc789.top）', async () => {
    const res = await checkinSite('https://aigc789.top', TOKEN, {
      fetchImpl: fakeFetch(200, '{"message":"Turnstile token 为空","success":false}'),
    });
    expect(res.ok).toBe(false);
    // 关键断言：状态码是 200，旧实现（只看 400/403）在这里会给出 needsManual:false
    expect(res.needsManual).toBe(true);
    expect(res.message).toContain('人机验证');
    // 不能把上游原文直接抛给用户——用户看不懂该做什么
    expect(res.message).not.toBe('Turnstile token 为空');
  });

  test('HTTP 403 + Turnstile 文案 → needsManual（原有行为不回退）', async () => {
    const res = await checkinSite('https://a.example.com', TOKEN, {
      fetchImpl: fakeFetch(403, 'turnstile verification required'),
    });
    expect(res.needsManual).toBe(true);
    expect(res.message).toContain('人机验证');
  });

  test('HTTP 400 + captcha 文案 → needsManual（原有行为不回退）', async () => {
    const res = await checkinSite('https://a.example.com', TOKEN, {
      fetchImpl: fakeFetch(400, '{"message":"captcha required","success":false}'),
    });
    expect(res.needsManual).toBe(true);
  });

  test('HTTP 200 + 「验证码」 → needsManual', async () => {
    const res = await checkinSite('https://a.example.com', TOKEN, {
      fetchImpl: fakeFetch(200, '{"message":"验证码错误","success":false}'),
    });
    expect(res.needsManual).toBe(true);
  });

  test('HTTP 200 + 「请先验证邮箱」 → 不误判为人机验证', async () => {
    // 200 上用收紧的正则，正是为了挡住这种与人机验证无关的业务提示：
    // 若沿用宽松式（含裸「验证」），用户会被导向「去网页过人机验证」这个错误动作。
    const res = await checkinSite('https://a.example.com', TOKEN, {
      fetchImpl: fakeFetch(200, '{"message":"请先验证邮箱后再签到","success":false}'),
    });
    expect(res.needsManual).toBe(false);
    expect(res.message).toBe('请先验证邮箱后再签到');
  });
});

describe('checkinSite 其余判定路径', () => {
  test('「签到功能未启用」仍判 needsManual 且文案原样（真实形状：api.aizzz.xyz）', async () => {
    const res = await checkinSite('https://api.aizzz.xyz', TOKEN, {
      fetchImpl: fakeFetch(200, '{"message":"签到功能未启用","success":false}'),
    });
    expect(res.ok).toBe(false);
    expect(res.needsManual).toBe(true);
    expect(res.message).toBe('签到功能未启用');
  });

  test('非 JSON 响应体 → 「签到接口返回异常」带状态码（真实形状：astu.online）', async () => {
    const res = await checkinSite('https://astu.online', TOKEN, {
      fetchImpl: fakeFetch(404, '404 page not found'),
    });
    expect(res.ok).toBe(false);
    expect(res.needsManual).toBe(false);
    expect(res.message).toBe('签到接口返回异常 (HTTP 404)');
  });

  test('空响应体 → 同样归为接口返回异常，不抛异常', async () => {
    const res = await checkinSite('https://a.example.com', TOKEN, {
      fetchImpl: fakeFetch(500, ''),
    });
    expect(res.ok).toBe(false);
    expect(res.message).toBe('签到接口返回异常 (HTTP 500)');
  });

  test('success:true + quota_awarded → 成功并折算美元', async () => {
    const res = await checkinSite('https://a.example.com', TOKEN, {
      fetchImpl: fakeFetch(
        200,
        '{"success":true,"message":"签到成功","data":{"quota_awarded":500000}}',
      ),
    });
    expect(res.ok).toBe(true);
    expect(res.needsManual).toBe(false);
    // 500000 quota = $1（QUOTA_PER_UNIT）
    expect(res.message).toBe('签到成功 (+$1.00)');
  });

  test('success:true 无 quota_awarded → 成功但不带金额', async () => {
    const res = await checkinSite('https://a.example.com', TOKEN, {
      fetchImpl: fakeFetch(200, '{"success":true,"message":"签到成功"}'),
    });
    expect(res.ok).toBe(true);
    expect(res.message).toBe('签到成功');
  });

  test('网络异常 → 返回失败结果而非抛出（后台任务不能抛）', async () => {
    const boom: FetchLike = async () => {
      throw new Error('connect ETIMEDOUT');
    };
    const res = await checkinSite('https://a.example.com', TOKEN, { fetchImpl: boom });
    expect(res.ok).toBe(false);
    expect(res.needsManual).toBe(false);
    expect(res.message).toContain('请求失败');
  });

  test('请求打在 POST {base}/api/user/checkin 上，且 base 尾斜杠被去掉', async () => {
    const seen: { url?: string; method?: string } = {};
    await checkinSite('https://a.example.com///', TOKEN, {
      fetchImpl: fakeFetch(200, '{"success":true,"message":"签到成功"}', seen),
    });
    expect(seen.url).toBe('https://a.example.com/api/user/checkin');
    expect(seen.method).toBe('POST');
  });
});
