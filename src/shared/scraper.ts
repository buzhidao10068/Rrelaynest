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
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

async function fetchJson(url: string, token: string, opts?: ScrapeOptions): Promise<unknown> {
  const doFetch = opts?.fetchImpl ?? fetch;
  const resp = await doFetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
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
  const doFetch = opts?.fetchImpl ?? fetch;
  let resp: Response;
  try {
    resp = await doFetch(`${base}/api/user/checkin`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
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
