// new-api 爬虫 + 签到：纯 fetch 逻辑，不触碰数据库，平台无关。
// - GET /api/pricing      → group_ratio(分组倍率) + usable_group(分组描述) + data[](模型定价)
// - GET /api/user/self    → data.quota，按 QuotaPerUnit=500000 换算余额
// - POST /api/user/checkin→ 签到（对齐 QuantumNous/new-api，见 prd.md Background）
// 认证：Authorization: Bearer <access_token>
import type { FetchLike } from './types.js';

export interface PricingGroup {
  group_name: string;
  group_ratio: number | null;
  group_desc: string | null;
}

export interface PricingModel {
  model_name: string;
  quota_type: number | null;
  model_ratio: number | null;
  completion_ratio: number | null;
  model_price: number | null;
  enable_groups: string[];
}

export interface ScrapeResult {
  balance: number | null; // 余额（站点货币，通常 USD）
  groups: PricingGroup[];
  models: PricingModel[];
}

export interface CheckinResult {
  ok: boolean;
  message: string; // 人类可读，写入 checkin_result
  needsManual: boolean; // Turnstile 拦截等需手动签到的情况
}

// quota 单位是内部额度，500000 quota = $1（new-api 默认 QuotaPerUnit）
const QUOTA_PER_UNIT = 500000;

// 爬取/签到选项。fetchImpl 是可注入的 fetch 实现（Node 代理注入用）：
// Node 侧传绑定了代理 dispatcher 的 undici.fetch；Workers/默认回落到全局 fetch。
// 用可注入 fetch 而非 dispatcher 的原因见记忆 proxy-fetch-dispatcher-binding：
// 全局 fetch 不认外部 undici 包的 dispatcher，必须用同一包的 fetch+dispatcher。
// 类型用与全局 fetch 兼容的签名，保持本文件平台无关（不 import undici）。
export interface ScrapeOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number; // 单次 HTTP 请求超时；<=0 或未设为不限时（保持原行为）
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

// 带超时的 fetch：用 AbortController 在 timeoutMs 后中止请求。timeoutMs<=0 时不设超时。
// 平台无关：AbortController/AbortSignal 在 Workers 与 Node 18+ 均原生可用。
async function fetchWithTimeout(
  doFetch: FetchLike,
  url: string,
  init: Record<string, unknown>,
  timeoutMs?: number,
): Promise<Response> {
  if (!timeoutMs || timeoutMs <= 0) return doFetch(url, init);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await doFetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    // AbortController 触发时抛 AbortError；转成可读的超时消息，落到 last_error。
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`请求超时（${timeoutMs}ms）@ ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url: string, token: string, opts?: ScrapeOptions): Promise<unknown> {
  // 全局 fetch 的 init 类型比 FetchLike 更严；两者都能吃我们传的普通对象，故收敛为 FetchLike。
  const doFetch = (opts?.fetchImpl ?? fetch) as FetchLike;
  const resp = await fetchWithTimeout(
    doFetch,
    url,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
    opts?.timeoutMs,
  );
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} ${resp.statusText} @ ${url}`);
  }
  return resp.json();
}

// /api/pricing → { success, data: [模型...], group_ratio: {分组:倍率}, usable_group: {分组:描述} }
function parsePricing(payload: unknown): { groups: PricingGroup[]; models: PricingModel[] } {
  const p = (payload ?? {}) as {
    group_ratio?: Record<string, number>;
    usable_group?: Record<string, string>;
    data?: unknown;
  };
  const groupRatio = p.group_ratio ?? {};
  const usableGroup = p.usable_group ?? {};

  const groupNames = new Set<string>([...Object.keys(groupRatio), ...Object.keys(usableGroup)]);
  const groups: PricingGroup[] = [...groupNames].map((name) => ({
    group_name: name,
    group_ratio: groupRatio[name] ?? null,
    group_desc: usableGroup[name] ?? null,
  }));

  const rawModels: unknown[] = Array.isArray(p.data) ? p.data : [];
  const models: PricingModel[] = rawModels
    .map((raw) => {
      const m = raw as Record<string, unknown>;
      return {
        model_name: String(m.model_name ?? ''),
        quota_type: typeof m.quota_type === 'number' ? m.quota_type : null,
        model_ratio: typeof m.model_ratio === 'number' ? m.model_ratio : null,
        completion_ratio: typeof m.completion_ratio === 'number' ? m.completion_ratio : null,
        model_price: typeof m.model_price === 'number' ? m.model_price : null,
        enable_groups: Array.isArray(m.enable_groups) ? m.enable_groups.map(String) : [],
      };
    })
    .filter((m) => m.model_name);

  return { groups, models };
}

// /api/user/self → { success, data: { quota, ... } }
function parseBalance(payload: unknown): number | null {
  const quota = (payload as { data?: { quota?: unknown } })?.data?.quota;
  if (typeof quota !== 'number') return null;
  return quota / QUOTA_PER_UNIT;
}

export async function scrapeSite(baseUrl: string, token: string, opts?: ScrapeOptions): Promise<ScrapeResult> {
  const base = normalizeBase(baseUrl);

  // pricing 是核心，必须成功
  const pricingRaw = (await fetchJson(`${base}/api/pricing`, token, opts)) as { success?: boolean; message?: string };
  if (pricingRaw?.success === false) {
    throw new Error(`pricing 接口返回失败：${pricingRaw?.message ?? '未知错误'}`);
  }
  const { groups, models } = parsePricing(pricingRaw);

  // 余额单独抓，失败不致命（有些站点关闭了该接口）
  let balance: number | null = null;
  try {
    const selfRaw = await fetchJson(`${base}/api/user/self`, token, opts);
    balance = parseBalance(selfRaw);
  } catch {
    balance = null;
  }

  return { balance, groups, models };
}

// 执行签到。对齐 QuantumNous/new-api：POST /api/user/checkin
// 成功 {success:true, message:'签到成功', data:{quota_awarded, checkin_date}}
// 失败 {success:false, message:'...'}；该端点挂 TurnstileCheck 中间件。
export async function checkinSite(baseUrl: string, token: string, opts?: ScrapeOptions): Promise<CheckinResult> {
  const base = normalizeBase(baseUrl);
  const doFetch = (opts?.fetchImpl ?? fetch) as FetchLike;
  let resp: Response;
  try {
    resp = await fetchWithTimeout(
      doFetch,
      `${base}/api/user/checkin`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      },
      opts?.timeoutMs,
    );
  } catch (err) {
    return {
      ok: false,
      message: `请求失败：${err instanceof Error ? err.message : String(err)}`,
      needsManual: false,
    };
  }

  // Turnstile 中间件在验证缺失时常返回 4xx；识别为需手动签到
  if (resp.status === 400 || resp.status === 403) {
    const text = await resp.text().catch(() => '');
    if (/turnstile|captcha|验证/i.test(text)) {
      return {
        ok: false,
        message: '该站开启了人机验证(Turnstile)，需手动到网页签到',
        needsManual: true,
      };
    }
  }

  const data = (await resp.json().catch(() => null)) as {
    success?: boolean;
    message?: string;
    data?: { quota_awarded?: number };
  } | null;
  if (!data) {
    return { ok: false, message: `签到接口返回异常 (HTTP ${resp.status})`, needsManual: false };
  }

  if (data.success) {
    const awarded = data.data?.quota_awarded;
    const usd = typeof awarded === 'number' ? ` (+$${(awarded / QUOTA_PER_UNIT).toFixed(2)})` : '';
    return { ok: true, message: `签到成功${usd}`, needsManual: false };
  }

  const msg = data.message ?? '签到失败';
  return { ok: false, message: msg, needsManual: /未启用|未开启/.test(msg) };
}

// ==== 测活（连通性 + 渠道测试）====
// 参考 QuantumNous/new-api 的 /channels 两种测试：
//  - 测试连接（connectivity）：GET /api/pricing，量响应耗时，判可达/较慢/不可达。
//  - 渠道测试（channel）：向 /v1/chat/completions 发一句测活词，看模型能否正常回复。

export interface PingResult {
  ok: boolean; // 可达（HTTP 2xx）
  status: number; // HTTP 状态码；网络错误为 0
  latencyMs: number; // 请求往返耗时（毫秒）
  message: string; // 人类可读（正常 / 较慢 / 不可达 / 超时）
}

// 较慢阈值（毫秒）：超过判「较慢」，但仍算可达。
const SLOW_THRESHOLD_MS = 2000;

// 测试连接：GET /api/pricing 量响应耗时。可达即 ok（不解析内容），仅按耗时分「正常 / 较慢」。
// 平台无关；走注入的 fetchImpl（可经代理）。失败（网络/超时）返回 ok=false，不抛。
export async function pingSite(baseUrl: string, token: string, opts?: ScrapeOptions): Promise<PingResult> {
  const base = normalizeBase(baseUrl);
  const doFetch = (opts?.fetchImpl ?? fetch) as FetchLike;
  const started = Date.now();
  try {
    const resp = await fetchWithTimeout(
      doFetch,
      `${base}/api/pricing`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } },
      opts?.timeoutMs,
    );
    const latencyMs = Date.now() - started;
    if (!resp.ok) {
      return { ok: false, status: resp.status, latencyMs, message: `不可达 (HTTP ${resp.status})` };
    }
    const slow = latencyMs > SLOW_THRESHOLD_MS;
    return {
      ok: true,
      status: resp.status,
      latencyMs,
      message: slow ? `较慢 ${latencyMs}ms` : `正常 ${latencyMs}ms`,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const msg = err instanceof Error ? err.message : String(err);
    // fetchWithTimeout 已把 AbortError 转成「请求超时」文案。
    return { ok: false, status: 0, latencyMs, message: /超时/.test(msg) ? msg : `不可达：${msg}` };
  }
}

export interface ChannelTestResult {
  ok: boolean; // 模型正常回复
  message: string; // 人类可读（可用 / 不可用 + 原因）
  model?: string; // 实际测试用的模型
  latencyMs: number;
}

// 渠道测试：向 /v1/chat/completions 发一句测活词（probe），看模型能否回复。
// 对齐 new-api testChannel（其写死 'hi'），此处 probe 由调用方按「单站绑定 > 全局默认」解析后传入。
// model 由调用方给（通常取该站已爬到的第一个模型）；缺失则用兜底名，让上游报错以暴露真实原因。
export async function channelTest(
  baseUrl: string,
  token: string,
  probe: string,
  model: string,
  opts?: ScrapeOptions,
): Promise<ChannelTestResult> {
  const base = normalizeBase(baseUrl);
  const doFetch = (opts?.fetchImpl ?? fetch) as FetchLike;
  const started = Date.now();
  let resp: Response;
  try {
    resp = await fetchWithTimeout(
      doFetch,
      `${base}/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: probe }],
          max_tokens: 16,
          stream: false,
        }),
      },
      opts?.timeoutMs,
    );
  } catch (err) {
    const latencyMs = Date.now() - started;
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: /超时/.test(msg) ? msg : `不可用：${msg}`, model, latencyMs };
  }

  const latencyMs = Date.now() - started;
  const data = (await resp.json().catch(() => null)) as {
    error?: { message?: string } | string;
    choices?: { message?: { content?: string } }[];
  } | null;

  if (!resp.ok || !data) {
    const errMsg =
      data && typeof data.error === 'object'
        ? data.error?.message
        : data && typeof data.error === 'string'
          ? data.error
          : `HTTP ${resp.status}`;
    return { ok: false, message: `不可用：${errMsg ?? `HTTP ${resp.status}`}`, model, latencyMs };
  }

  // 有 choices[].message.content 即视为模型正常回复。
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return { ok: true, message: `可用 ${latencyMs}ms`, model, latencyMs };
  }
  return { ok: false, message: '不可用：响应无有效回复', model, latencyMs };
}
