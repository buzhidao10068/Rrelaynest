// 代理池（Phase E 起：编辑弹窗的出站代理下拉需要它；完整代理页 Phase F 落地）。
// 每条 { name, type, host, port, user, pass, enabled }；globalProxy=选作全局的代理名（''=直连）。
// 唯一事实来源：site.proxy = 代理名（''=跟随全局/直连）；改名/删除/停用需级联同步 sites[].proxy 与 globalProxy。
import { reactive } from 'vue';
import { sitesState } from '@/stores/sites';

export type ProxyType = 'http' | 'https' | 'socks5';

export interface Proxy {
  name: string;
  type: ProxyType;
  host: string;
  port: number;
  user: string;
  pass: string;
  enabled: boolean;
}

// 代理表单载荷（新增/编辑弹窗提交后由 saveProxy 落库）
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
  globalProxy: string; // 全局代理名（''=直连）
}

export const proxyState = reactive<ProxyState>({
  list: [
    { name: '本地-Clash', type: 'http', host: '127.0.0.1', port: 7890, user: '', pass: '', enabled: true },
    { name: '机场-香港', type: 'socks5', host: 'hk.example.com', port: 1080, user: 'vpnuser', pass: 'secret', enabled: true },
    { name: '公司-出口', type: 'https', host: 'gw.corp.example', port: 8443, user: '', pass: '', enabled: false },
  ],
  globalProxy: '',
});

// 代理类型徽章配色：http=蓝 / https=绿 / socks5=紫
export const PROXY_TYPE_STYLE: Record<ProxyType, string> = {
  http: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  https: 'bg-green-500/15 text-green-600 dark:text-green-400',
  socks5: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
};

// 下拉基础标签：null=跟随全局/直连
export function proxyBaseLabel(p: Proxy | null): string {
  if (!p) return '跟随全局设置';
  return `${p.name}（${p.type}://${p.host}:${p.port}）`;
}

// ---- 查询 ----
export function findProxy(name: string): Proxy | undefined {
  return proxyState.list.find((p) => p.name === name);
}
// 重名校验（编辑时用 exclude 排除自身）
export function proxyNameExists(name: string, exclude: string | null): boolean {
  return proxyState.list.some((p) => p.name === name && p.name !== exclude);
}
// 绑定到某代理的站点数（卡片「配置站点」徽章）
export function proxySiteCount(name: string): number {
  return sitesState.list.filter((s) => s.proxy === name).length;
}

// ---- 全局代理 ----
export function setGlobalProxy(name: string): void {
  proxyState.globalProxy = name || '';
}

// ---- CRUD ----
// 新增/编辑：edit 传原名（editingName）；新增传 null。改名会级联同步 sites[].proxy 与 globalProxy。
export function saveProxy(form: ProxyForm, editingName: string | null): void {
  if (editingName != null) {
    const ex = findProxy(editingName);
    if (!ex) return;
    ex.name = form.name;
    ex.type = form.type;
    ex.host = form.host;
    ex.port = form.port;
    ex.user = form.user;
    ex.pass = form.pass;
    if (editingName !== form.name) {
      sitesState.list.forEach((s) => { if (s.proxy === editingName) s.proxy = form.name; });
      if (proxyState.globalProxy === editingName) proxyState.globalProxy = form.name;
    }
  } else {
    proxyState.list.push({ ...form, enabled: true });
  }
}

// 切换启用位；停用的若正是全局代理，则回落直连。返回切换后的 enabled 态。
export function toggleProxyEnabled(name: string): boolean | null {
  const p = findProxy(name);
  if (!p) return null;
  p.enabled = !p.enabled;
  if (!p.enabled && proxyState.globalProxy === name) proxyState.globalProxy = '';
  return p.enabled;
}

// 删除：清空绑定它的站点（回落跟随全局）+ 若是全局代理则回落直连。
export function deleteProxy(name: string): boolean {
  const idx = proxyState.list.findIndex((p) => p.name === name);
  if (idx < 0) return false;
  if (proxyState.globalProxy === name) proxyState.globalProxy = '';
  sitesState.list.forEach((s) => { if (s.proxy === name) s.proxy = ''; });
  proxyState.list.splice(idx, 1);
  return true;
}

// ---- 站点 ↔ 代理绑定（代理页「配置站点」弹窗保存）----
// checked 站点绑定此代理；取消勾选且原本绑的是此代理 → 清空（回落跟随全局）。返回绑定数。
export function assignSitesToProxy(name: string, checkedNames: Set<string>): number {
  let cnt = 0;
  sitesState.list.forEach((s) => {
    if (checkedNames.has(s.name)) { s.proxy = name; cnt++; }
    else if (s.proxy === name) { s.proxy = ''; }
  });
  return cnt;
}
