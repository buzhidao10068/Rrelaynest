// normalizeBaseUrl 边界表：断言表照搬 task research 文档「算法验证」节的实测结果。
// 这张表专门盯住「能抓住简化实现」的四条（见 implement.md S2）：
//  - 'astu.online:8080'    只判「new URL 没抛」会把它当成协议 astu.online: 放行
//  - 'javascript:alert(1)' 同上，且是注入面
//  - 'astu.online' + 拼 /api/pricing  ← 本次故障本体（缺协议头 → fetch 拒收相对 URL）
//  - 'HTTPS://A.B'         大写协议不能被当成未知协议拒掉
import { test, expect } from 'vitest';
import { normalizeBaseUrl } from './site-url.js';

// 期望通过的输入 → 归一化后的值 + 是否补过协议头。
// addedScheme 必须如实：路由层靠它区分「用户新填的（该退回去让他填全）」与
// 「存量库里的（协议头已丢失，只能接受补值）」，报错了会让 POST 放行裸域名。
const ACCEPT: [input: string, expected: string, addedScheme: boolean][] = [
  // 缺协议头：补 https://（本次故障本体的输入形状）
  ['astu.online', 'https://astu.online', true],
  ['astu.online/api', 'https://astu.online/api', true],
  // 缺协议头 + 端口：只判「没抛」的实现会把 'astu.online:' 当协议放行
  ['astu.online:8080', 'https://astu.online:8080', true],
  ['1.2.3.4:3000', 'https://1.2.3.4:3000', true],
  // 已带协议头：原样保留（含 http，不静默升级成 https）
  ['https://a.b', 'https://a.b', false],
  ['http://c.d', 'http://c.d', false],
  // 大写协议头 + 大写主机名：协议与主机名小写化，路径大小写保留
  ['HTTPS://A.B', 'https://a.b', false],
  ['HTTP://E.F/X/', 'http://e.f/X', false],
  // 末尾斜杠一律去掉（拼 `${base}/api/pricing` 时留着会出双斜杠）
  ['https://g.h/v1/', 'https://g.h/v1', false],
  ['https://a.b///', 'https://a.b', false],
  ['http://a.b/', 'http://a.b', false],
  // 子路径 + 非标端口都保留
  ['https://a.b:8080/v1', 'https://a.b:8080/v1', false],
  // IPv6 字面量
  ['http://[::1]:8080', 'http://[::1]:8080', false],
  // 首尾空白先 trim
  ['  https://a.b  ', 'https://a.b', false],
  // 协议相对 URL 被当作裸主机处理（已记录的可接受副作用）
  ['//a.b', 'https://a.b', true],
];

// 期望拒绝的输入 → 文案里必须出现的关键词。
const REJECT: [input: string, msgIncludes: string][] = [
  ['', '必填'],
  ['   ', '必填'],
  // 注入面：只判「没抛」的实现会放行（new URL('javascript:alert(1)') 是成功的）
  ['javascript:alert(1)', '不是合法的 URL'],
  // 其它协议一律不猜
  ['file:///etc/passwd', '只支持 http:// 或 https://'],
  ['ftp://x', '只支持 http:// 或 https://'],
  ['x://a.b', '只支持 http:// 或 https://'],
  // 非法 scheme 形状：若前置 https:// 会静默存成 'https://1foo//x' 这种垃圾值
  ['1foo://x', '只支持 http:// 或 https://'],
  // 带 query / fragment：origin+pathname 会把它们静默丢掉，故拒
  ['https://a.b?x=1', '查询参数'],
  ['https://a.b#frag', '# 片段'],
  // 带凭据：同样会被 origin+pathname 静默丢掉
  ['https://user:pw@a.b', '用户名/密码'],
  // 解析失败
  ['a b', '不是合法的 URL'],
  ['https://', '不是合法的 URL'],
];

test('normalizeBaseUrl：合法输入归一化为绝对 URL（无末尾斜杠），并如实报告 addedScheme', () => {
  for (const [input, expected, addedScheme] of ACCEPT) {
    const res = normalizeBaseUrl(input);
    expect(res, `输入 ${JSON.stringify(input)} 应被接受`).toEqual({
      ok: true,
      value: expected,
      addedScheme,
    });
  }
});

test('normalizeBaseUrl：非法输入一律拒，文案可直接回给用户', () => {
  for (const [input, msgIncludes] of REJECT) {
    const res = normalizeBaseUrl(input);
    expect(res.ok, `输入 ${JSON.stringify(input)} 应被拒绝`).toBe(false);
    if (!res.ok) expect(res.message).toContain(msgIncludes);
  }
});

test('normalizeBaseUrl：非字符串输入（缺字段/类型不对）按必填拒', () => {
  for (const raw of [undefined, null, 42, {}, []]) {
    const res = normalizeBaseUrl(raw);
    expect(res.ok, `输入 ${JSON.stringify(raw)} 应被拒绝`).toBe(false);
  }
});

// 本次故障本体：归一化后的值拼上爬虫的固定路径，必须是 fetch 能接受的绝对 URL。
// 修复前存的是裸 'astu.online'，拼出 'astu.online/api/pricing'，fetch 在发网络请求前就抛
// Invalid URL —— 这条用例把「拼接后仍是绝对 URL」钉死在归一化层。
test('归一化后拼 /api/pricing 是绝对 URL（本次故障本体）', () => {
  const res = normalizeBaseUrl('astu.online');
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  const url = `${res.value}/api/pricing`;
  expect(url).toBe('https://astu.online/api/pricing');
  // new URL 单参构造只接受绝对 URL：不抛即证明它是绝对的。
  expect(() => new URL(url)).not.toThrow();
  expect(new URL(url).protocol).toBe('https:');
});

// 幂等：把归一化结果再喂一次，值不变、且 addedScheme 变 false（输出必然带协议头）。
// PUT 未传 base_url 时会对存量值再跑一次，不幂等就会在每次「只改备注」时悄悄改地址。
test('normalizeBaseUrl 幂等：再归一化一次值不变、addedScheme 归 false', () => {
  for (const [input] of ACCEPT) {
    const once = normalizeBaseUrl(input);
    expect(once.ok).toBe(true);
    if (!once.ok) continue;
    expect(normalizeBaseUrl(once.value)).toEqual({
      ok: true,
      value: once.value,
      addedScheme: false,
    });
  }
});
