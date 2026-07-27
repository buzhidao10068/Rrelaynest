// 上游站点真调封装（Phase：上游模型获取 + 按模型测活）。
// 后端 src/shared|server|worker 为禁改区，故这些请求由「浏览器直接 fetch」站点 URL 发起。
// 注意：浏览器跨源直连第三方 API 受 CORS 约束——若对方不发 CORS 头，响应会被浏览器拦截，
// 这里统一 try/catch 后抛出/返回可读的失败态，UI 优雅降级。种子的假域名必然失败，属预期。

// url 去 scheme 头尾后补 https、去尾斜杠、去尾 /v1，得到规范 base（不含末尾 /v1）。
export function normalizeBase(raw: string): string {
  let u = (raw || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  u = u.replace(/\/+$/, '');            // 去尾斜杠
  u = u.replace(/\/v1$/i, '');          // 去尾 /v1（下面统一再拼）
  return u;
}

function authHeaders(token: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = (token || '').trim();
  if (t) h['Authorization'] = 'Bearer ' + t;
  return h;
}

// 带超时的 fetch：假域名/CORS 卡住时不至于一直挂着（42 站串行会拖很久）。
const DEFAULT_TIMEOUT = 10000;
async function fetchWithTimeout(input: string, init: RequestInit, ms = DEFAULT_TIMEOUT): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// 拉上游模型：GET {base}/v1/models，解析 data[].id。异常抛可读 Error。
export async function fetchModels(url: string, token: string): Promise<string[]> {
  const base = normalizeBase(url);
  if (!base) throw new Error('站点地址为空');
  let resp: Response;
  try {
    resp = await fetchWithTimeout(base + '/v1/models', { method: 'GET', headers: authHeaders(token) });
  } catch (e) {
    throw new Error('请求失败（网络不可达、超时或被 CORS 拦截）');
  }
  if (!resp.ok) {
    throw new Error(`上游返回 ${resp.status}${resp.status === 401 ? '（密钥无效）' : ''}`);
  }
  let json: unknown;
  try {
    json = await resp.json();
  } catch {
    throw new Error('响应不是合法 JSON');
  }
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) throw new Error('响应缺少 data 数组');
  const ids = data
    .map((m) => (m && typeof m === 'object' ? (m as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (!ids.length) throw new Error('上游未返回任何模型');
  // 去重保序
  return Array.from(new Set(ids));
}

export interface ConnResult { ok: boolean; ms: number; error?: string; }

// 测试连接：计时一次轻量 GET {base}/v1/models。>550ms 判较慢由调用方处理；网络失败 ok=false。
export async function testConnectivity(url: string, token: string): Promise<ConnResult> {
  const base = normalizeBase(url);
  if (!base) return { ok: false, ms: 0, error: '站点地址为空' };
  const t0 = performance.now();
  try {
    const resp = await fetchWithTimeout(base + '/v1/models', { method: 'GET', headers: authHeaders(token) });
    const ms = Math.round(performance.now() - t0);
    // 只要能拿到 HTTP 响应即视为「可达」（401/403 也算连通，仅密钥问题）
    return { ok: resp.ok || resp.status === 401 || resp.status === 403, ms };
  } catch {
    return { ok: false, ms: Math.round(performance.now() - t0), error: '网络不可达或被 CORS 拦截' };
  }
}

export interface ModelTestResult { ok: boolean; error?: string; }

// 渠道测试（单模型）：POST {base}/v1/chat/completions，发一句测活词，200 且含 choices 判可用。
export async function testChannelModel(
  url: string, token: string, model: string, probe: string,
): Promise<ModelTestResult> {
  const base = normalizeBase(url);
  if (!base) return { ok: false, error: '站点地址为空' };
  let resp: Response;
  try {
    resp = await fetchWithTimeout(base + '/v1/chat/completions', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: probe || 'hi' }],
        max_tokens: 1,
      }),
    });
  } catch {
    return { ok: false, error: '网络不可达或被 CORS 拦截' };
  }
  if (!resp.ok) return { ok: false, error: `上游返回 ${resp.status}` };
  try {
    const json = await resp.json();
    const choices = (json as { choices?: unknown })?.choices;
    return { ok: Array.isArray(choices) && choices.length > 0 };
  } catch {
    return { ok: false, error: '响应不是合法 JSON' };
  }
}
