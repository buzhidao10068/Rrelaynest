// 前端 API 客户端：所有 /api 请求的统一入口（块8 接线地基）。
// 职责：JSON 收发、带 cookie（credentials:'include'）、错误归一成可读中文、401 统一踢回登录。
// 各 store 只调这里的 apiGet/apiPost/apiPut/apiDelete，不直接 fetch，保证鉴权/错误处理一致。
//
// 约定：后端所有端点返回 JSON；出错时形如 { error: '文案' }（见 src/shared/routes.ts）。
// 本客户端把非 2xx 与网络异常都抛成带可读 message 的 ApiError，调用方 try/catch 后 toast。

// 401 回调：由 App 挂载时注入（避免 api.ts 反向依赖 ui store，防循环依赖）。
// 未登录/会话失效时后端返回 401，这里触发回调让 UI 切回登录页。
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// 非文件下载类端点统一走这里。method/body 由各 helper 包装。
// resp.ok=false 时优先取 body.error 文案；401 额外触发 onUnauthorized。
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(path, {
      method,
      credentials: 'include', // 带 rn_session cookie
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // 网络层失败（断网/DNS/被拦截）：无 HTTP 状态，归一成 0。
    throw new ApiError('网络请求失败（无法连接服务器）', 0);
  }

  if (resp.status === 401) {
    // 会话失效：先解析文案（若有），再触发全局登出回调，最后抛错让调用方停下。
    const msg = await readError(resp, '未登录或会话已失效');
    if (onUnauthorized) onUnauthorized();
    throw new ApiError(msg, 401);
  }

  if (!resp.ok) {
    throw new ApiError(await readError(resp, `请求失败（HTTP ${resp.status}）`), resp.status);
  }

  // 204 或空体：返回 undefined（调用方泛型标 void 即可）。
  const text = await resp.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError('响应不是合法 JSON', resp.status);
  }
}

// 从错误响应体里取 { error } 文案；解析失败回落到 fallback。
async function readError(resp: Response, fallback: string): Promise<string> {
  try {
    const data = (await resp.clone().json()) as { error?: unknown };
    if (data && typeof data.error === 'string' && data.error) return data.error;
  } catch {
    /* body 非 JSON，用 fallback */
  }
  return fallback;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>('GET', path);
}
export function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, body);
}
export function apiPut<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PUT', path, body);
}
export function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('DELETE', path, body);
}

// 便捷聚合对象：api.get/post/put/del，与上面的 helper 等价，任选其一。
export const api = {
  get: apiGet,
  post: apiPost,
  put: apiPut,
  del: apiDelete,
};
