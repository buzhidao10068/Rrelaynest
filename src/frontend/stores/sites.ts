// 站点表格状态 + 派生逻辑（块8：接线为后端 server-cache）。
// 事实来源改为后端 /api/sites（每用户隔离，见 routes.ts）；本 store 只是它的前端缓存：
// 每次增删改后 reload() 重拉，不再在前端做余额/签到记账。id 为后端主键，name 仅展示/去重用。
//
// 与 mock 的关键差异（见块8 sites 接线决策）：
//  - 余额是「爬取权威」：不再由充值/签到在前端累加。编辑弹窗仍可填一个种子余额(balance)。
//  - 汇率 rate = 充值¥ / 到账额，落后端单值 rate（=每 1 单位站点货币折多少 RMB）。
//  - 签到收敛成一个开关：checkin_enabled ⇒ 每日自动签到(后端 scheduler 全量跑)；
//    行内「签到」按钮 = 立即 POST /checkin，toast 结果。砍掉「默认金额/手动金额」记账。
//  - 模型来自爬取(site_models)，只读展示；不再前端手动维护。
//  - 充值弹窗与流水记录本轮砍掉（records.ts 保留但不写）。
// 视图态（列宽/分页/紧凑/批量/分组折叠/拖拽）全部保留在前端。
import { reactive, computed } from 'vue';
import { api } from '@/api';
import { t } from '@/i18n';

// signed=今日已签 / pending=启用签到但今日未签 / off=未启用
export type CheckinState = 'signed' | 'pending' | 'off';

export interface Site {
  id: number;
  name: string;
  baseUrl: string; // 后端 base_url 原样：绝对 URL（含 http(s)://），权威值。链接与编辑回填都用它
  // ⚠ 展示专用（去掉协议头的短地址），禁止用于构造请求或链接：
  // 协议头一旦丢掉就无法恢复，硬编码拼回 'https://' 会把 http 站点静默升级、非标端口站点打不开。
  // 本轮故障就是保存时剥掉协议头、爬取时又没补，拼出相对 URL 被 fetch 拒收。要请求就用 baseUrl。
  url: string;
  balNum: number | null;
  bal: string;
  rmb: string;
  rate: string;
  ck: CheckinState;
  scraped: string;
  rmbNum: number;
  scrapedMin: number;
  hasToken: boolean;
  group: string; // 后端 group_label（用户自定义分组）；'' = 未分组
  probeText?: string; // 后端 probe_text；'' = 跟随全局
  proxyId: number | null; // 后端 proxy_id；null = 跟随全局/直连
  cur?: string;
  email?: string;
  note?: string;
  models?: string[]; // 爬取所得模型名（site_models），只读
  lastError?: string | null;
  checkinResult?: string | null;
  // token 明文不再由后端返回（只给 has_token）；测活/渠道测试改走后端端点。
  // 保留该字段仅为兼容旧 composable 的类型（运行时恒 undefined）。
  token?: string;
}

export type SortDir = 'asc' | 'desc' | null;

// 签到状态排序优先级：已签 < 待签 < 未启用
export const ckOrder: Record<CheckinState, number> = { signed: 0, pending: 1, off: 2 };

// 货币符号映射：未知币种留空(数值前不加符号)
const CUR_SIGNS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', RMB: '¥', HKD: 'HK$', AUD: 'A$', CAD: 'C$',
};
export function curSign(cur?: string): string {
  return CUR_SIGNS[(cur || '').toUpperCase()] || '';
}

export interface Column {
  key: string;
  labelKey: string;
  sortable: boolean;
  visible: boolean;
  always?: boolean;
  width: number;
  defW: number;
}

// ---- 后端行 → 前端 Site ----
interface ModelApiRow { model_name: string }
interface SiteApiRow {
  id: number;
  name: string;
  base_url: string;
  rate: number | null;
  currency: string;
  balance: number | null;
  checkin_enabled: number;
  checkin_done: number;
  last_checkin_at: number | null;
  checkin_result: string | null;
  email: string | null;
  note: string | null;
  sort_order: number;
  last_scraped_at: number | null;
  last_error: string | null;
  proxy_id: number | null;
  probe_text: string | null;
  group_label: string | null;
  has_token: boolean;
  models: ModelApiRow[];
}

// 相对时间：对齐 mock 文案（刚刚 / X 分钟前 / X 小时前 / X 天前 / 未爬取）。
function relTime(ts: number | null): { text: string; min: number } {
  if (!ts) return { text: t('sites.neverScraped'), min: Infinity };
  const diffMs = Date.now() - ts;
  const min = Math.max(0, Math.floor(diffMs / 60000));
  if (min < 1) return { text: t('sites.justNow'), min: 0 };
  if (min < 60) return { text: t('sites.minutesAgo', { n: min }), min };
  const hr = Math.floor(min / 60);
  if (hr < 24) return { text: t('sites.hoursAgo', { n: hr }), min };
  const day = Math.floor(hr / 24);
  return { text: t('sites.daysAgo', { n: day }), min };
}

function mapRow(r: SiteApiRow): Site {
  const cur = r.currency || 'USD';
  const rate = r.rate ?? 1;
  const balNum = r.balance;
  const rmbNum = balNum == null ? 0 : Math.round(balNum * rate * 100) / 100;
  const rt = relTime(r.last_scraped_at);
  const ck: CheckinState = !r.checkin_enabled ? 'off' : r.checkin_done ? 'signed' : 'pending';
  return {
    id: r.id,
    name: r.name,
    baseUrl: r.base_url || '',
    // 派生的展示值（有损）；权威值是上面的 baseUrl。
    url: (r.base_url || '').replace(/^https?:\/\//i, '').replace(/\/+$/, ''),
    balNum,
    bal: balNum == null ? '—' : curSign(cur) + balNum.toFixed(2),
    rmb: balNum == null ? '—' : '¥' + rmbNum.toFixed(2),
    rate: String(rate),
    ck,
    scraped: rt.text,
    rmbNum,
    scrapedMin: rt.min,
    hasToken: !!r.has_token,
    group: r.group_label || '',
    probeText: r.probe_text || '',
    proxyId: r.proxy_id,
    cur,
    email: r.email || '',
    note: r.note || '',
    models: (r.models ?? []).map((m) => m.model_name),
    lastError: r.last_error,
    checkinResult: r.checkin_result,
    token: undefined,
  };
}

// ---- 编辑/新建弹窗表单载荷 ----
export interface SiteForm {
  name: string;
  url: string; // 完整 URL（带 scheme）
  token: string; // 空=保留原 token（编辑）/ 不设（新建）
  balRaw: string; // 余额种子输入（空=不设/不改）
  rechargeRmb: number; // 用于折算 rate：rate = rmb/amount
  rechargeAmount: number;
  cur: string;
  group: string;
  proxyId: number | null;
  probeText: string;
  email: string;
  note: string;
  ckMaster: boolean; // 签到主开关 → checkin_enabled
}

// ---- 列配置 ----
export const ACTION_COL_W = 150;
export const MIN_COL_W = 60;
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100];

interface SitesState {
  list: Site[];
  loading: boolean;
  loaded: boolean;
  columns: Column[];
  sortKey: string | null;
  sortDir: SortDir;
  pageSize: number;
  currentPage: number;
  paginationHidden: boolean;
  groupMode: boolean;
  collapsedGroups: Record<string, boolean>;
  batchMode: boolean;
  selected: Set<number>; // 按 id 选中
  compact: boolean;
}

const COMPACT_KEY = 'relaynest-compact-default';

export const sitesState = reactive<SitesState>({
  list: [],
  loading: false,
  loaded: false,
  columns: [
    { key: 'name',    labelKey: 'sites.colName',    sortable: true,  visible: true, always: true, width: 180, defW: 180 },
    { key: 'url',     labelKey: 'sites.colUrl',     sortable: false, visible: true, width: 200, defW: 200 },
    { key: 'bal',     labelKey: 'sites.colBalance', sortable: true,  visible: true, width: 110, defW: 110 },
    { key: 'rmb',     labelKey: 'sites.colRmb',     sortable: false, visible: true, width: 110, defW: 110 },
    { key: 'rate',    labelKey: 'sites.colRate',    sortable: false, visible: true, width: 90,  defW: 90  },
    { key: 'ck',      labelKey: 'sites.colCheckin', sortable: true,  visible: true, width: 150, defW: 150 },
    { key: 'scraped', labelKey: 'sites.colScraped', sortable: true,  visible: true, width: 130, defW: 130 },
  ],
  sortKey: null,
  sortDir: null,
  pageSize: 10,
  currentPage: 1,
  paginationHidden: false,
  groupMode: false,
  collapsedGroups: {},
  batchMode: false,
  selected: new Set<number>(),
  compact: localStorage.getItem(COMPACT_KEY) === 'true',
});

export { PAGE_SIZE_OPTIONS };

// 从后端重拉站点列表（含爬取所得 models）。失败抛错，调用方 toast。
export async function loadSites(): Promise<void> {
  sitesState.loading = true;
  try {
    const res = await api.get<{ sites: SiteApiRow[] }>('/api/sites');
    sitesState.list = res.sites.map(mapRow);
    sitesState.loaded = true;
    // 清理指向已删站点的选中项
    const ids = new Set(sitesState.list.map((s) => s.id));
    for (const id of [...sitesState.selected]) if (!ids.has(id)) sitesState.selected.delete(id);
  } finally {
    sitesState.loading = false;
  }
}

// 各列比较器
const comparators: Record<string, (a: Site, b: Site) => number> = {
  name:    (a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'),
  bal:     (a, b) => a.rmbNum - b.rmbNum,
  ck:      (a, b) => ckOrder[a.ck] - ckOrder[b.ck],
  scraped: (a, b) => a.scrapedMin - b.scrapedMin,
};

export const visibleColumns = computed(() => sitesState.columns.filter((c) => c.visible));

export function colVisible(key: string): boolean {
  return sitesState.columns.some((c) => c.key === key && c.visible);
}

// 依当前排序算出的完整列表
export const sortedSites = computed<Site[]>(() => {
  const list = sitesState.list.slice();
  if (sitesState.sortKey && sitesState.sortDir) {
    const cmp = comparators[sitesState.sortKey];
    const dir = sitesState.sortDir;
    if (cmp) list.sort((a, b) => { const r = cmp(a, b); return dir === 'asc' ? r : -r; });
  }
  return list;
});

export const totalPages = computed(() => {
  if (sitesState.paginationHidden) return 1;
  return Math.max(1, Math.ceil(sitesState.list.length / sitesState.pageSize));
});

// 当前页切片（分组/隐藏分页时返回全部）
export const pagedSites = computed<Site[]>(() => {
  const list = sortedSites.value;
  if (sitesState.paginationHidden || sitesState.groupMode) return list;
  const tp = totalPages.value;
  const page = Math.min(sitesState.currentPage, tp);
  const start = (page - 1) * sitesState.pageSize;
  return list.slice(start, start + sitesState.pageSize);
});

// 按声明顺序去重收集分组名
export const allGroups = computed<string[]>(() => {
  const seen: Record<string, boolean> = {};
  const out: string[] = [];
  sitesState.list.forEach((s) => { const g = s.group || '未分组'; if (!seen[g]) { seen[g] = true; out.push(g); } });
  return out;
});

// 分组视图：{ group, rows, sum } —— 组内套用当前排序
export const groupedSites = computed(() => {
  const sorted = sortedSites.value;
  const groups = allGroups.value;
  const byGroup: Record<string, Site[]> = {};
  groups.forEach((g) => { byGroup[g] = []; });
  sorted.forEach((s) => { const g = s.group || '未分组'; (byGroup[g] = byGroup[g] || []).push(s); });
  return groups.map((g) => {
    const rows = byGroup[g] || [];
    const sum = rows.reduce((a, s) => a + (s.rmbNum || 0), 0);
    return { group: g, rows, sum };
  });
});

// ---- 统计卡 ----
export const stats = computed(() => {
  const total = sitesState.list.length;
  const sum = sitesState.list.reduce((a, s) => a + (s.rmbNum || 0), 0);
  const signed = sitesState.list.filter((s) => s.ck === 'signed').length;
  const enabled = sitesState.list.filter((s) => s.ck !== 'off').length;
  return {
    total: String(total),
    balance: '¥' + sum.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    checkin: signed + '/' + enabled,
  };
});

export function findSite(id: number): Site | undefined {
  return sitesState.list.find((x) => x.id === id);
}

// ---- 排序：点同列 null→asc→desc→null；换列从 asc 起 ----
export function toggleSort(key: string): void {
  if (sitesState.sortKey !== key) { sitesState.sortKey = key; sitesState.sortDir = 'asc'; }
  else { sitesState.sortDir = sitesState.sortDir === 'asc' ? 'desc' : sitesState.sortDir === 'desc' ? null : 'asc'; }
  if (sitesState.sortDir === null) sitesState.sortKey = null;
}

// ---- 分页 ----
export function goToPage(p: number): void {
  const tp = totalPages.value;
  sitesState.currentPage = Math.min(Math.max(1, p), tp);
}
export function setPageSize(n: number): void {
  const firstIdx = (sitesState.currentPage - 1) * sitesState.pageSize;
  sitesState.pageSize = n;
  sitesState.currentPage = Math.floor(firstIdx / sitesState.pageSize) + 1;
}
export function setPaginationHidden(hidden: boolean): void {
  sitesState.paginationHidden = hidden;
  if (!hidden) sitesState.currentPage = 1;
}
// 页码带省略：首/末/当前±1 恒显，其余「…」折叠
export function pageList(cur: number, tp: number): (number | '...')[] {
  if (tp <= 7) { const all: number[] = []; for (let i = 1; i <= tp; i++) all.push(i); return all; }
  const out: (number | '...')[] = [1];
  const lo = Math.max(2, cur - 1), hi = Math.min(tp - 1, cur + 1);
  if (lo > 2) out.push('...');
  for (let j = lo; j <= hi; j++) out.push(j);
  if (hi < tp - 1) out.push('...');
  out.push(tp);
  return out;
}

// ---- 分组模式 ----
export function toggleGroupMode(): void { sitesState.groupMode = !sitesState.groupMode; }
export function toggleGroup(g: string): void { sitesState.collapsedGroups[g] = !sitesState.collapsedGroups[g]; }

// ---- 紧凑模式 ----
export function toggleCompact(): void {
  sitesState.compact = !sitesState.compact;
  localStorage.setItem(COMPACT_KEY, sitesState.compact ? 'true' : 'false');
}

// ---- 列宽 ----
export const tableMinWidth = computed(() =>
  visibleColumns.value.reduce((a, c) => a + (c.width || 0), 0) + ACTION_COL_W);
export function setColWidth(key: string, w: number): void {
  const col = sitesState.columns.find((c) => c.key === key);
  if (col) col.width = Math.max(MIN_COL_W, Math.round(w));
}
export function toggleColVisible(key: string): void {
  const col = sitesState.columns.find((c) => c.key === key);
  if (col && !col.always) col.visible = !col.visible;
}
export function moveColumn(from: number, to: number): void {
  const cols = sitesState.columns;
  if (from < 0 || from >= cols.length || to < 0 || to >= cols.length) return;
  const moved = cols.splice(from, 1)[0];
  cols.splice(to, 0, moved);
}
export function resetCustomize(): void {
  sitesState.columns.forEach((c) => { c.visible = true; c.width = c.defW; });
  if (sitesState.compact) toggleCompact();
}

// ---- 批量选择（按 id）----
export function toggleBatch(): void {
  sitesState.batchMode = !sitesState.batchMode;
  if (!sitesState.batchMode) sitesState.selected.clear();
}
export function toggleSelect(id: number): void {
  if (sitesState.selected.has(id)) sitesState.selected.delete(id);
  else sitesState.selected.add(id);
}
export function selectAll(): void {
  if (sitesState.selected.size === sitesState.list.length) sitesState.selected.clear();
  else sitesState.list.forEach((s) => sitesState.selected.add(s.id));
}
export function toggleGroupSelect(g: string): void {
  const rows = sitesState.list.filter((s) => (s.group || '未分组') === g);
  const allSel = rows.length > 0 && rows.every((s) => sitesState.selected.has(s.id));
  if (allSel) rows.forEach((s) => sitesState.selected.delete(s.id));
  else rows.forEach((s) => sitesState.selected.add(s.id));
}
// 批量删除：逐个 DELETE 后 reload。返回删除个数。
export async function batchDelete(): Promise<number> {
  const ids = [...sitesState.selected];
  if (!ids.length) return 0;
  for (const id of ids) await api.del(`/api/sites/${id}`);
  sitesState.selected.clear();
  await loadSites();
  return ids.length;
}

// ---- 行拖拽重排：调整 sort_order（跨组则同时改 group_label），落后端 ----
// 简化：把移动后列表的顺序整体写回（仅 PUT 变化的行的 sort_order/group_label）。
export async function reorderRow(fromId: number, overId: number, intoGroup?: string): Promise<void> {
  const fromIdx = sitesState.list.findIndex((s) => s.id === fromId);
  if (fromIdx < 0) return;
  const moved = sitesState.list[fromIdx];
  const newGroup = intoGroup != null && intoGroup !== '未分组' ? intoGroup : intoGroup === '未分组' ? '' : moved.group;
  const groupChanged = newGroup !== moved.group;
  // 本地先重排（乐观）：移到 overId 之前/后
  sitesState.list.splice(fromIdx, 1);
  const overIdx = sitesState.list.findIndex((s) => s.id === overId);
  if (overIdx < 0) { sitesState.list.splice(fromIdx, 0, moved); return; }
  if (groupChanged) moved.group = newGroup;
  sitesState.list.splice(overIdx, 0, moved);
  // 落后端：重排后按位置写 sort_order；分组变化的行连带写 group_label。
  await persistOrder(groupChanged ? moved.id : undefined);
}
export async function moveToGroup(id: number, group: string): Promise<boolean> {
  const s = findSite(id);
  const g = group === '未分组' ? '' : group;
  if (!s || s.group === g) return false;
  s.group = g;
  await api.put(`/api/sites/${id}`, { group_label: g });
  await loadSites();
  return true;
}
// 把当前列表顺序写回后端 sort_order（0..n）；withGroupId 若给，则该行连带写 group_label。
async function persistOrder(withGroupId?: number): Promise<void> {
  for (let i = 0; i < sitesState.list.length; i++) {
    const s = sitesState.list[i];
    const body: Record<string, unknown> = { sort_order: i };
    if (withGroupId === s.id) body.group_label = s.group;
    await api.put(`/api/sites/${s.id}`, body);
  }
  await loadSites();
}

// ---- 单站操作（后端权威）----
// 爬取：POST /api/sites/:id/scrape，成功 reload。返回后端结果（含 ok/error/balance）。
export async function scrapeSite(id: number): Promise<{ ok: boolean; error?: string }> {
  const res = await api.post<{ ok: boolean; error?: string }>(`/api/sites/${id}/scrape`);
  await loadSites();
  return res;
}
// 签到：POST /api/sites/:id/checkin，成功 reload。返回后端结果（含 ok/result）。
export async function checkinSite(id: number): Promise<{ ok: boolean; result?: string; needs_manual?: boolean }> {
  const res = await api.post<{ ok: boolean; result?: string; needs_manual?: boolean }>(`/api/sites/${id}/checkin`);
  await loadSites();
  return res;
}
export async function deleteSite(id: number): Promise<boolean> {
  await api.del(`/api/sites/${id}`);
  sitesState.selected.delete(id);
  await loadSites();
  return true;
}
// 全部爬取：POST /api/scrape-all（后端受限并发），完成 reload。返回结果数组。
export async function scrapeAll(): Promise<{ ok: boolean }[]> {
  const res = await api.post<{ results: { ok: boolean }[] }>('/api/scrape-all');
  await loadSites();
  return res.results ?? [];
}

// ---- 危险区：清空本用户全部站点（逐个 DELETE）----
export async function clearAll(): Promise<void> {
  const ids = sitesState.list.map((s) => s.id);
  for (const id of ids) await api.del(`/api/sites/${id}`);
  sitesState.selected.clear();
  sitesState.batchMode = false;
  sitesState.currentPage = 1;
  await loadSites();
}

// 名称唯一性校验（编辑时排除自身 id）。仅前端友好提示；后端无 name 唯一约束。
export function nameExists(name: string, excludeId: number | null): boolean {
  return sitesState.list.some((s) => s.name === name && s.id !== excludeId);
}

// 新建（editingId=null）或编辑站点，落后端后 reload。返回站名（供 toast）。
export async function saveSite(form: SiteForm, editingId: number | null): Promise<string> {
  const rmb = form.rechargeRmb, amt = form.rechargeAmount;
  const rate = amt > 0 ? Math.round((rmb / amt) * 10000) / 10000 : null;
  const cur = form.cur.trim() || 'USD';
  let group = form.group.trim();
  if (group === '未分组') group = '';
  const balNum = form.balRaw.trim() === '' ? null : parseFloat(form.balRaw);

  const body: Record<string, unknown> = {
    name: form.name.trim(),
    // 原样发绝对 URL（弹窗已校验必须含 http(s)://），由后端归一化落库。
    // 别再在这里剥协议头：库里存裸域名 → 爬取拼出相对 URL → fetch 直接拒收（本轮故障根因）。
    base_url: form.url.trim(),
    rate,
    currency: cur,
    checkin_enabled: form.ckMaster,
    email: form.email.trim() || null,
    note: form.note || null,
    proxy_id: form.proxyId,
    probe_text: form.probeText || '',
    group_label: group,
  };
  // token 非空才发（编辑留空=保留原 token；后端 undefined=不变）。
  if (form.token) body.token = form.token;
  // 余额种子：仅在填了时发（避免编辑时把爬取值清掉）。
  if (form.balRaw.trim() !== '') body.balance = balNum;

  if (editingId == null) {
    await api.post('/api/sites', body);
  } else {
    await api.put(`/api/sites/${editingId}`, body);
  }
  await loadSites();
  return body.name as string;
}
