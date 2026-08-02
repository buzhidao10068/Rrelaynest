// 代理池 store（块8：接线为后端 server-cache）。
// 事实来源改为后端 /api/proxies（每用户隔离，见 routes.ts）；本 store 只是它的前端缓存：
// 每次增删改后 reload() 重拉，不再在前端维护级联。id 为后端主键，name 仅展示/去重用。
// 全局代理落后端 settings 的 global_proxy_id（按 id），读写走 /api/settings。
// 站点 ↔ 代理绑定已接线后端（按 id，PUT /api/sites/:id { proxy_id }），见文件底部。
import { reactive } from 'vue';
import { api } from '@/api';
import { sitesState, loadSites } from '@/stores/sites';
import { t } from '@/i18n';

export type ProxyType = 'http' | 'https' | 'socks5';

// 前端代理视图：对齐后端 GET /api/proxies 返回（密码不回传，只给 has_password）。
export interface Proxy {
  id: number;
  name: string;
  type: ProxyType;
  host: string;
  port: number;
  user: string; // 后端 username（可空）
  hasPassword: boolean; // 后端 has_password：是否已设密码（明文不回传）
  enabled: boolean;
}

// 代理表单载荷（新增/编辑弹窗提交）。pass 为明文：新增时可选；编辑时留空=不修改。
export interface ProxyForm {
  name: string;
  type: ProxyType;
  host: string;
  port: number;
  user: string;
  pass: string;
}

interface ProxyState {
  list: Proxy[];
  globalProxyId: number | null; // 全局代理 id（null=直连）
  loading: boolean;
  loaded: boolean;
}

export const proxyState = reactive<ProxyState>({
  list: [],
  globalProxyId: null,
  loading: false,
  loaded: false,
});

// 后端行 → 前端 Proxy。
interface ProxyApiRow {
  id: number;
  name: string;
  type: string;
  host: string;
  port: number;
  username: string | null;
  has_password: boolean;
  enabled: number;
}
function mapRow(r: ProxyApiRow): Proxy {
  const t = r.type === 'https' || r.type === 'socks5' ? r.type : 'http';
  return {
    id: r.id,
    name: r.name,
    type: t,
    host: r.host,
    port: r.port,
    user: r.username ?? '',
    hasPassword: !!r.has_password,
    enabled: !!r.enabled,
  };
}

// 从后端重拉代理列表 + 全局代理设置。任一失败抛错，调用方 toast。
export async function loadProxies(): Promise<void> {
  proxyState.loading = true;
  try {
    const [proxies, settings] = await Promise.all([
      api.get<{ proxies: ProxyApiRow[] }>('/api/proxies'),
      api.get<{ settings: Record<string, string> }>('/api/settings'),
    ]);
    proxyState.list = proxies.proxies.map(mapRow);
    const gid = Number(settings.settings.global_proxy_id);
    proxyState.globalProxyId = Number.isFinite(gid) && gid > 0 ? gid : null;
    proxyState.loaded = true;
  } finally {
    proxyState.loading = false;
  }
}

// 代理类型徽章配色：http=蓝 / https=绿 / socks5=紫
export const PROXY_TYPE_STYLE: Record<ProxyType, string> = {
  http: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  https: 'bg-green-500/15 text-green-600 dark:text-green-400',
  socks5: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
};

// ---- 查询 ----
export function findProxy(id: number): Proxy | undefined {
  return proxyState.list.find((p) => p.id === id);
}
export function globalProxy(): Proxy | undefined {
  return proxyState.globalProxyId == null ? undefined : findProxy(proxyState.globalProxyId);
}
// 重名校验（编辑时用 excludeId 排除自身）。仅前端友好提示；后端无 name 唯一约束。
export function proxyNameExists(name: string, excludeId: number | null): boolean {
  return proxyState.list.some((p) => p.name === name && p.id !== excludeId);
}

// ---- 全局代理（落后端 settings.global_proxy_id）----
export async function setGlobalProxy(id: number | null): Promise<void> {
  await api.put('/api/settings', { global_proxy_id: id == null ? '' : String(id) });
  proxyState.globalProxyId = id;
}

// ---- CRUD（后端权威，改动后 reload）----
// 新增（editingId=null）或编辑。pass 留空：新增=不设密码，编辑=不修改。
export async function saveProxy(form: ProxyForm, editingId: number | null): Promise<void> {
  const base: Record<string, unknown> = {
    name: form.name,
    type: form.type,
    host: form.host,
    port: form.port,
    username: form.user || null,
  };
  // pass 非空才发（编辑时空=保留原密码；后端 undefined=不变）。
  if (form.pass) base.password = form.pass;

  if (editingId == null) {
    await api.post('/api/proxies', base);
  } else {
    await api.put(`/api/proxies/${editingId}`, base);
  }
  await loadProxies();
}

// 切换启用位（后端持久化后 reload）。返回切换后的 enabled 态；失败抛错。
export async function toggleProxyEnabled(id: number): Promise<boolean> {
  const p = findProxy(id);
  if (!p) throw new Error(t('proxy.errNotFound'));
  const next = !p.enabled;
  await api.put(`/api/proxies/${id}`, { enabled: next });
  await loadProxies();
  return next;
}

// 删除（后端级联解绑站点 + 清全局代理，见 routes.ts）。改动后 reload。
export async function deleteProxy(id: number): Promise<void> {
  await api.del(`/api/proxies/${id}`);
  await loadProxies();
}

// ---- 站点 ↔ 代理绑定（接线后端，按 id）----
// 绑定该代理的站点数（代理卡「配置站点」徽章）。按 proxy_id 计。
export function proxySiteCount(proxyId: number): number {
  return sitesState.list.filter((s) => s.proxyId === proxyId).length;
}
// checkedIds 站点绑定此代理；取消勾选且原本绑的是此代理 → 清空(proxy_id=null, 回落全局)。
// 逐个 PUT /api/sites/:id { proxy_id } 后 reload 站点列表。返回绑定数。
export async function assignSitesToProxy(
  proxyId: number,
  checkedIds: Set<number>,
): Promise<number> {
  let cnt = 0;
  for (const s of sitesState.list) {
    if (checkedIds.has(s.id)) {
      if (s.proxyId !== proxyId) await api.put(`/api/sites/${s.id}`, { proxy_id: proxyId });
      cnt++;
    } else if (s.proxyId === proxyId) {
      await api.put(`/api/sites/${s.id}`, { proxy_id: null });
    }
  }
  await loadSites();
  return cnt;
}
