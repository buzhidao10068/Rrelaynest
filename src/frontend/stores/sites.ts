// 站点表格状态 + 派生逻辑（Phase D）。
// 忠实移植 mock 的数据流：init 时 deriveRecharge + recalcBalance 会用 cur(初始 undefined)
// 重算 bal/rmb —— 因此种子数据的余额列显示为裸数字(无币种符号)，RMB 按派生 ratio 重算。
// 轻量 reactive 单例，不引 Pinia。
import { reactive, computed } from 'vue';

export type CheckinState = 'signed' | 'manual' | 'off';

export interface Site {
  name: string;
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
  autoCheckin: boolean;
  defAmtEnabled: boolean;
  defAmt: number | null;
  ckAmount: number | null;
  group: string;
  probeText?: string;
  proxy?: string;
  cur?: string;
  rechargeRmb?: number;
  rechargeAmount?: number;
  email?: string;
  note?: string;
}

// 编辑/新建弹窗的表单载荷（提交后由 saveSite 落库）
export interface SiteForm {
  name: string;
  url: string;         // 完整 URL（带 scheme）
  token: string;       // 空=保留原 token
  balRaw: string;      // 余额输入（空=未知）
  rechargeRmb: number;
  rechargeAmount: number;
  cur: string;
  group: string;
  proxy: string;
  probeText: string;
  email: string;
  note: string;
  ckMaster: boolean;
  autoOn: boolean;
  defAmtOn: boolean;
  defAmtRaw: string;
}

export interface Column {
  key: string;
  label: string;
  sortable: boolean;
  visible: boolean;
  always?: boolean;
  width: number;
  defW: number;
}

export type SortDir = 'asc' | 'desc' | null;

// 签到状态排序优先级：已签 < 需手动 < 未启用
export const ckOrder: Record<CheckinState, number> = { signed: 0, manual: 1, off: 2 };

// 货币符号映射：未知币种留空(数值前不加符号)
const CUR_SIGNS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', RMB: '¥', HKD: 'HK$', AUD: 'A$', CAD: 'C$',
};
export function curSign(cur?: string): string {
  return CUR_SIGNS[(cur || '').toUpperCase()] || '';
}

// 折算比率 ratio = 充值人民币 / 到账站点货币(1 单位站点货币值多少 RMB)
export function ratioOf(s: Site): number {
  const rmb = parseFloat(String(s.rechargeRmb));
  const amt = parseFloat(String(s.rechargeAmount));
  if (!(rmb > 0) || !(amt > 0)) return 1;
  return rmb / amt;
}

// 兼容旧演示数据：只有 rate(=ratio) 时按「充 10 元」反推到账额度
export function deriveRecharge(s: Site): void {
  if (s.rechargeRmb != null && s.rechargeAmount != null) return;
  const ratio = parseFloat(s.rate) || 1;
  s.rechargeRmb = 10;
  s.rechargeAmount = Math.round((10 / ratio) * 100) / 100;
}

// 依 balNum 重算 bal / rmbNum / rmb；balNum=null 视为未知，显示 —
export function recalcBalance(s: Site): void {
  if (s.balNum == null || isNaN(s.balNum)) {
    s.bal = '—'; s.rmbNum = 0; s.rmb = '—';
    return;
  }
  s.balNum = Math.round(s.balNum * 100) / 100;
  s.bal = curSign(s.cur) + s.balNum.toFixed(2);
  s.rmbNum = Math.round(s.balNum * ratioOf(s) * 100) / 100;
  s.rmb = '¥' + s.rmbNum.toFixed(2);
}

// ---- 种子数据（42 站，忠实自 mock）----
const seed: Site[] = [
  { name:'OpenAI-Relay', url:'api.openai-relay.com',   balNum:48.20,  bal:'$48.20',  rmb:'¥346.94', rate:'7.20', ck:'signed',  scraped:'2 分钟前',  rmbNum:346.94, scrapedMin:2,   hasToken:true,  autoCheckin:false, defAmtEnabled:true,  defAmt:0.10, ckAmount:0.10, group:'主力' },
  { name:'GPT中转-A',     url:'gpt-zhongzhuan.net',     balNum:520.00, bal:'¥520.00', rmb:'¥520.00', rate:'1.00', ck:'manual',  scraped:'15 分钟前', rmbNum:520.00, scrapedMin:15,  hasToken:true,  autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'主力' },
  { name:'Claude-Pool',  url:'pool.claude-cn.io',      balNum:120.50, bal:'$120.50', rmb:'¥867.60', rate:'7.20', ck:'signed',  scraped:'1 小时前',  rmbNum:867.60, scrapedMin:60,  hasToken:true,  autoCheckin:true,  defAmtEnabled:true,  defAmt:0.20, ckAmount:0.20, group:'主力', probeText:'你好' },
  { name:'API聚合站',     url:'api-juhe.cn',            balNum:88.00,  bal:'¥88.00',  rmb:'¥88.00',  rate:'1.00', ck:'off',     scraped:'未爬取',    rmbNum:88.00,  scrapedMin:Infinity, hasToken:true,  autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'备用' },
  { name:'DeepSeek-Hub', url:'hub.deepseek-relay.com', balNum:12.30,  bal:'$12.30',  rmb:'¥88.56',  rate:'7.20', ck:'manual',  scraped:'3 小时前',  rmbNum:88.56,  scrapedMin:180, hasToken:true,  autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'备用', probeText:'ping' },
  { name:'Gemini-中转',  url:'gemini-relay.example.com', balNum:null, bal:'—',    rmb:'—',       rate:'7.20', ck:'manual',  scraped:'未爬取',    rmbNum:0,      scrapedMin:Infinity, hasToken:false, autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'测试' },
  { name:'Azure-OpenAI', url:'azure-oai-proxy.cn',     balNum:256.80, bal:'$256.80', rmb:'¥1849.00', rate:'7.20', ck:'signed',  scraped:'5 分钟前',  rmbNum:1849.00, scrapedMin:5,   hasToken:true,  autoCheckin:true,  defAmtEnabled:true,  defAmt:0.50, ckAmount:0.50, group:'主力' },
  { name:'月之暗面-Kimi', url:'kimi-relay.moonshot.cn', balNum:66.66,  bal:'¥66.66',  rmb:'¥66.66',  rate:'1.00', ck:'manual',  scraped:'42 分钟前', rmbNum:66.66,  scrapedMin:42,  hasToken:true,  autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'备用' },
  { name:'智谱-GLM',      url:'open.bigmodel.cn',       balNum:18.00,  bal:'¥18.00',  rmb:'¥18.00',  rate:'1.00', ck:'off',     scraped:'6 小时前',  rmbNum:18.00,  scrapedMin:360, hasToken:true,  autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'备用' },
  { name:'Grok-Relay',   url:'grok.x-relay.io',        balNum:5.00,   bal:'$5.00',   rmb:'¥36.00',  rate:'7.20', ck:'signed',  scraped:'刚刚',      rmbNum:36.00,  scrapedMin:0,   hasToken:true,  autoCheckin:true,  defAmtEnabled:false, defAmt:null, ckAmount:1.00, group:'机动' },
  { name:'硅基流动',      url:'api.siliconflow.cn',     balNum:314.15, bal:'¥314.15', rmb:'¥314.15', rate:'1.00', ck:'manual',  scraped:'2 小时前',  rmbNum:314.15, scrapedMin:120, hasToken:true,  autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'备用' },
  { name:'Together-AI',  url:'api.together.xyz',       balNum:0.00,   bal:'$0.00',   rmb:'¥0.00',   rate:'7.20', ck:'off',     scraped:'1 天前',    rmbNum:0.00,   scrapedMin:1440, hasToken:true, autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'测试' },
  { name:'Anthropic-CN', url:'anthropic-cn-0.example.com', balNum:159.00, bal:'$159.00', rmb:'¥1144.80', rate:'7.20', ck:'signed', scraped:'刚刚', rmbNum:1144.8, scrapedMin:0, hasToken:true, autoCheckin:true, defAmtEnabled:true, defAmt:0.10, ckAmount:0.10, group:'主力' },
  { name:'Mistral-Hub', url:'mistral-hub-1.example.com', balNum:163.00, bal:'¥163.00', rmb:'¥163.00', rate:'1.00', ck:'manual', scraped:'3 分钟前', rmbNum:163, scrapedMin:3, hasToken:true, autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'备用' },
  { name:'Cohere-Relay', url:'cohere-relay-2.example.com', balNum:193.00, bal:'€193.00', rmb:'¥1515.05', rate:'7.85', ck:'off', scraped:'12 分钟前', rmbNum:1515.05, scrapedMin:12, hasToken:true, autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'测试' },
  { name:'Perplexity-中转', url:'perplexity-3.example.com', balNum:223.00, bal:'£223.00', rmb:'¥2029.30', rate:'9.10', ck:'signed', scraped:'28 分钟前', rmbNum:2029.3, scrapedMin:28, hasToken:true, autoCheckin:true, defAmtEnabled:false, defAmt:null, ckAmount:0.50, group:'机动' },
  { name:'Groq-Fast', url:'groq-fast-4.example.com', balNum:188.00, bal:'$188.00', rmb:'¥1353.60', rate:'7.20', ck:'manual', scraped:'1 小时前', rmbNum:1353.6, scrapedMin:60, hasToken:true, autoCheckin:false, defAmtEnabled:true, defAmt:0.50, ckAmount:null, group:'备用' },
  { name:'Fireworks-AI', url:'fireworks-ai-5.example.com', balNum:244.00, bal:'¥244.00', rmb:'¥244.00', rate:'1.00', ck:'off', scraped:'2 小时前', rmbNum:244, scrapedMin:120, hasToken:true, autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'测试' },
  { name:'OpenRouter-CN', url:'openrouter-cn-6.example.com', balNum:null, bal:'—', rmb:'—', rate:'7.85', ck:'signed', scraped:'4 小时前', rmbNum:0, scrapedMin:240, hasToken:false, autoCheckin:true, defAmtEnabled:false, defAmt:null, ckAmount:0.50, group:'机动' },
  { name:'百度-文心', url:'relay-7.example.com', balNum:187.00, bal:'£187.00', rmb:'¥1701.70', rate:'9.10', ck:'manual', scraped:'8 小时前', rmbNum:1701.7, scrapedMin:480, hasToken:true, autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'备用' },
  { name:'阿里-通义', url:'relay-8.example.com', balNum:204.00, bal:'$204.00', rmb:'¥1468.80', rate:'7.20', ck:'off', scraped:'1 天前', rmbNum:1468.8, scrapedMin:1440, hasToken:true, autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'备用' },
  { name:'讯飞-星火', url:'relay-9.example.com', balNum:null, bal:'—', rmb:'—', rate:'1.00', ck:'signed', scraped:'未爬取', rmbNum:0, scrapedMin:Infinity, hasToken:true, autoCheckin:true, defAmtEnabled:false, defAmt:null, ckAmount:0.50, group:'机动' },
  { name:'腾讯-混元', url:'relay-10.example.com', balNum:238.00, bal:'€238.00', rmb:'¥1868.30', rate:'7.85', ck:'manual', scraped:'刚刚', rmbNum:1868.3, scrapedMin:0, hasToken:true, autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'备用' },
  { name:'字节-豆包', url:'relay-11.example.com', balNum:255.00, bal:'£255.00', rmb:'¥2320.50', rate:'9.10', ck:'off', scraped:'3 分钟前', rmbNum:2320.5, scrapedMin:3, hasToken:true, autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'备用' },
  { name:'零一万物', url:'relay-12.example.com', balNum:259.00, bal:'$259.00', rmb:'¥1864.80', rate:'7.20', ck:'signed', scraped:'12 分钟前', rmbNum:1864.8, scrapedMin:12, hasToken:true, autoCheckin:true, defAmtEnabled:true, defAmt:0.30, ckAmount:0.30, group:'主力' },
  { name:'MiniMax-API', url:'minimax-api-13.example.com', balNum:null, bal:'—', rmb:'—', rate:'1.00', ck:'manual', scraped:'28 分钟前', rmbNum:0, scrapedMin:28, hasToken:false, autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'测试' },
  { name:'阶跃星辰', url:'relay-14.example.com', balNum:293.00, bal:'€293.00', rmb:'¥2300.05', rate:'7.85', ck:'off', scraped:'1 小时前', rmbNum:2300.05, scrapedMin:60, hasToken:true, autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'机动' },
  { name:'商汤-日日新', url:'relay-15.example.com', balNum:336.00, bal:'£336.00', rmb:'¥3057.60', rate:'9.10', ck:'signed', scraped:'2 小时前', rmbNum:3057.6, scrapedMin:120, hasToken:true, autoCheckin:true, defAmtEnabled:false, defAmt:null, ckAmount:0.50, group:'主力' },
  { name:'Replicate-Hub', url:'replicate-hub-16.example.com', balNum:44.00, bal:'$44.00', rmb:'¥316.80', rate:'7.20', ck:'manual', scraped:'4 小时前', rmbNum:316.8, scrapedMin:240, hasToken:true, autoCheckin:false, defAmtEnabled:true, defAmt:0.20, ckAmount:null, group:'机动' },
  { name:'DeepInfra', url:'deepinfra-17.example.com', balNum:9.00, bal:'¥9.00', rmb:'¥9.00', rate:'1.00', ck:'off', scraped:'8 小时前', rmbNum:9, scrapedMin:480, hasToken:true, autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'测试' },
  { name:'Novita-AI', url:'novita-ai-18.example.com', balNum:26.00, bal:'€26.00', rmb:'¥204.10', rate:'7.85', ck:'signed', scraped:'1 天前', rmbNum:204.1, scrapedMin:1440, hasToken:true, autoCheckin:true, defAmtEnabled:false, defAmt:null, ckAmount:0.50, group:'测试' },
  { name:'Lepton-AI', url:'lepton-ai-19.example.com', balNum:null, bal:'—', rmb:'—', rate:'9.10', ck:'manual', scraped:'未爬取', rmbNum:0, scrapedMin:Infinity, hasToken:true, autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'测试' },
  { name:'AnyScale-中转', url:'anyscale-20.example.com', balNum:null, bal:'—', rmb:'—', rate:'7.20', ck:'off', scraped:'刚刚', rmbNum:0, scrapedMin:0, hasToken:false, autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'测试' },
  { name:'Vertex-Gemini', url:'vertex-gemini-21.example.com', balNum:129.00, bal:'¥129.00', rmb:'¥129.00', rate:'1.00', ck:'signed', scraped:'3 分钟前', rmbNum:129, scrapedMin:3, hasToken:true, autoCheckin:true, defAmtEnabled:false, defAmt:null, ckAmount:0.50, group:'机动' },
  { name:'Bedrock-Relay', url:'bedrock-relay-22.example.com', balNum:146.00, bal:'€146.00', rmb:'¥1146.10', rate:'7.85', ck:'manual', scraped:'12 分钟前', rmbNum:1146.1, scrapedMin:12, hasToken:true, autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'机动' },
  { name:'Ollama-Cloud', url:'ollama-cloud-23.example.com', balNum:150.00, bal:'£150.00', rmb:'¥1365.00', rate:'9.10', ck:'off', scraped:'28 分钟前', rmbNum:1365, scrapedMin:28, hasToken:true, autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'机动' },
  { name:'LM-Studio-Net', url:'lm-studio-net-24.example.com', balNum:180.00, bal:'$180.00', rmb:'¥1296.00', rate:'7.20', ck:'signed', scraped:'1 小时前', rmbNum:1296, scrapedMin:60, hasToken:true, autoCheckin:true, defAmtEnabled:true, defAmt:0.50, ckAmount:0.50, group:'主力' },
  { name:'Poe-API', url:'poe-api-25.example.com', balNum:119.00, bal:'¥119.00', rmb:'¥119.00', rate:'1.00', ck:'manual', scraped:'2 小时前', rmbNum:119, scrapedMin:120, hasToken:true, autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'备用' },
  { name:'You-com-中转', url:'you-com-26.example.com', balNum:175.00, bal:'€175.00', rmb:'¥1373.75', rate:'7.85', ck:'off', scraped:'4 小时前', rmbNum:1373.75, scrapedMin:240, hasToken:true, autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'机动' },
  { name:'Phind-Relay', url:'phind-relay-27.example.com', balNum:null, bal:'—', rmb:'—', rate:'9.10', ck:'signed', scraped:'8 小时前', rmbNum:0, scrapedMin:480, hasToken:false, autoCheckin:true, defAmtEnabled:false, defAmt:null, ckAmount:0.50, group:'机动' },
  { name:'Cursor-Pool', url:'cursor-pool-28.example.com', balNum:222.00, bal:'$222.00', rmb:'¥1598.40', rate:'7.20', ck:'manual', scraped:'1 天前', rmbNum:1598.4, scrapedMin:1440, hasToken:true, autoCheckin:false, defAmtEnabled:true, defAmt:0.40, ckAmount:null, group:'机动' },
  { name:'Windsurf-API', url:'windsurf-api-29.example.com', balNum:null, bal:'—', rmb:'—', rate:'1.00', ck:'off', scraped:'未爬取', rmbNum:0, scrapedMin:Infinity, hasToken:true, autoCheckin:false, defAmtEnabled:false, defAmt:null, ckAmount:null, group:'测试' },
];

// 归一化：派生 recharge + 按新公式重算(覆盖手写死值，保证口径一致)
seed.forEach((s) => { deriveRecharge(s); recalcBalance(s); });

// ---- 列配置 ----
export const ACTION_COL_W = 150;
export const MIN_COL_W = 60;
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100];

interface SitesState {
  list: Site[];
  columns: Column[];
  sortKey: string | null;
  sortDir: SortDir;
  pageSize: number;
  currentPage: number;
  paginationHidden: boolean;
  groupMode: boolean;
  collapsedGroups: Record<string, boolean>;
  batchMode: boolean;
  selected: Set<string>;
  compact: boolean;
}

const COMPACT_KEY = 'relaynest-compact-default';

export const sitesState = reactive<SitesState>({
  list: seed,
  columns: [
    { key: 'name',    label: '站点名称', sortable: true,  visible: true, always: true, width: 180, defW: 180 },
    { key: 'url',     label: '地址',     sortable: false, visible: true, width: 200, defW: 200 },
    { key: 'bal',     label: '余额',     sortable: true,  visible: true, width: 110, defW: 110 },
    { key: 'rmb',     label: '折算RMB',  sortable: false, visible: true, width: 110, defW: 110 },
    { key: 'rate',    label: '汇率',     sortable: false, visible: true, width: 90,  defW: 90  },
    { key: 'ck',      label: '签到状态', sortable: true,  visible: true, width: 150, defW: 150 },
    { key: 'scraped', label: '上次爬取', sortable: true,  visible: true, width: 130, defW: 130 },
  ],
  sortKey: null,
  sortDir: null,
  pageSize: 10,
  currentPage: 1,
  paginationHidden: false,
  groupMode: false,
  collapsedGroups: {},
  batchMode: false,
  selected: new Set<string>(),
  compact: localStorage.getItem(COMPACT_KEY) === 'true',
});

export { PAGE_SIZE_OPTIONS };

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

export function findSite(name: string): Site | undefined {
  return sitesState.list.find((x) => x.name === name);
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

// ---- 批量选择 ----
export function toggleBatch(): void {
  sitesState.batchMode = !sitesState.batchMode;
  if (!sitesState.batchMode) sitesState.selected.clear();
}
export function toggleSelect(name: string): void {
  if (sitesState.selected.has(name)) sitesState.selected.delete(name);
  else sitesState.selected.add(name);
}
export function selectAll(): void {
  if (sitesState.selected.size === sitesState.list.length) sitesState.selected.clear();
  else sitesState.list.forEach((s) => sitesState.selected.add(s.name));
}
export function toggleGroupSelect(g: string): void {
  const rows = sitesState.list.filter((s) => (s.group || '未分组') === g);
  const allSel = rows.length > 0 && rows.every((s) => sitesState.selected.has(s.name));
  if (allSel) rows.forEach((s) => sitesState.selected.delete(s.name));
  else rows.forEach((s) => sitesState.selected.add(s.name));
}
export function batchDelete(): number {
  const n = sitesState.selected.size;
  if (!n) return 0;
  sitesState.list = sitesState.list.filter((s) => !sitesState.selected.has(s.name));
  sitesState.selected.clear();
  return n;
}

// ---- 行拖拽重排（调整原始顺序 / 跨组改分组）----
export function reorderRow(fromName: string, overName: string, intoGroup?: string): void {
  const fromIdx = sitesState.list.findIndex((s) => s.name === fromName);
  if (fromIdx < 0) return;
  const moved = sitesState.list[fromIdx];
  if (intoGroup != null && (moved.group || '未分组') !== intoGroup) moved.group = intoGroup;
  const overIdx = sitesState.list.findIndex((s) => s.name === overName);
  if (overIdx < 0) return;
  sitesState.list.splice(fromIdx, 1);
  const newOverIdx = sitesState.list.findIndex((s) => s.name === overName);
  sitesState.list.splice(newOverIdx, 0, moved);
}
export function moveToGroup(name: string, group: string): boolean {
  const s = findSite(name);
  if (!s || (s.group || '未分组') === group) return false;
  s.group = group;
  return true;
}

// ---- 单站操作 ----
// 模拟爬取：确定性伪随机余额，重算并把「上次爬取」置为「刚刚」
export function scrapeSite(name: string): boolean {
  const s = findSite(name);
  if (!s || !s.hasToken) return false;
  s.balNum = Math.round((10 + (name.length * 7 % 90)) * 100) / 100;
  recalcBalance(s);
  s.scraped = '刚刚'; s.scrapedMin = 0;
  return true;
}
export function deleteSite(name: string): boolean {
  const idx = sitesState.list.findIndex((s) => s.name === name);
  if (idx < 0) return false;
  sitesState.list.splice(idx, 1);
  sitesState.selected.delete(name);
  return true;
}

// 签到落账：标记已签 + 记录本次到账额 + 累加到余额（余额未知则以到账额为起点）
export function applyCheckin(s: Site, amt: number): void {
  s.ck = 'signed';
  s.ckAmount = amt;
  s.balNum = (s.balNum == null || isNaN(s.balNum)) ? amt : (s.balNum + amt);
  recalcBalance(s);
}

// 签到入口：返回签到结果。
//  'done'        —— 已按默认金额直接签到（无需弹窗），带 amountText/balanceText
//  'already'     —— 今日已签，忽略
//  'need-amount' —— 无默认金额，需弹窗填金额（Phase E 的手动签到弹窗）
//  'blocked'     —— 无 token 且未启用签到，禁用
export type CheckinStatus = 'done' | 'already' | 'need-amount' | 'blocked';
export interface CheckinResult {
  status: CheckinStatus;
  amountText?: string;
  balanceText?: string;
}
export function checkinSite(name: string): CheckinResult {
  const s = findSite(name);
  if (!s) return { status: 'blocked' };
  if (!s.hasToken && s.ck === 'off') return { status: 'blocked' };
  if (s.ck === 'signed') return { status: 'already' };
  if (s.defAmtEnabled && s.defAmt != null && (s.defAmt as unknown) !== '' && Number(s.defAmt) >= 0) {
    const amt = Number(s.defAmt);
    applyCheckin(s, amt);
    return {
      status: 'done',
      amountText: curSign(s.cur) + amt.toFixed(2),
      balanceText: curSign(s.cur) + (s.balNum ?? 0).toFixed(2),
    };
  }
  return { status: 'need-amount' };
}

// 手动签到（弹窗填金额路径）：落账后返回到账/余额文案供 toast
export function manualCheckin(name: string, amt: number): { amountText: string; balanceText: string } | null {
  const s = findSite(name);
  if (!s || !(amt >= 0)) return null;
  applyCheckin(s, amt);
  return {
    amountText: curSign(s.cur) + amt.toFixed(2),
    balanceText: curSign(s.cur) + (s.balNum ?? 0).toFixed(2),
  };
}

// URL 归一化成 host（去 scheme / 末尾斜杠）
export function normHost(u: string): string {
  return (u || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

// 名称唯一性校验（编辑时排除自身）
export function nameExists(name: string, exclude: string | null): boolean {
  return sitesState.list.some((s) => s.name === name && s.name !== exclude);
}

// 新建/编辑落库。editingName=null 新建；否则就地更新原对象。
// 返回创建/保存后的站名（供 toast）。校验由调用方（弹窗）先行完成。
export function saveSite(form: SiteForm, editingName: string | null): string {
  const rmb = form.rechargeRmb, amt = form.rechargeAmount;
  const cur = form.cur.trim() || 'USD';
  let group = form.group.trim();
  if (group === '未分组') group = '';
  const balNum = form.balRaw.trim() === '' ? null : parseFloat(form.balRaw);
  const defAmtNum = (form.ckMaster && form.defAmtOn) ? parseFloat(form.defAmtRaw) : null;
  const ckMaster = form.ckMaster;

  if (editingName === null) {
    const ns: Site = {
      name: form.name.trim(),
      url: normHost(form.url),
      balNum, bal: '—', rmb: '—', rmbNum: 0,
      rechargeRmb: rmb, rechargeAmount: amt,
      rate: (rmb / amt).toFixed(2), cur,
      email: form.email.trim(), note: form.note,
      ck: ckMaster ? 'manual' : 'off',
      scraped: '未爬取', scrapedMin: Infinity,
      hasToken: !!form.token,
      autoCheckin: ckMaster && form.autoOn,
      defAmtEnabled: ckMaster && form.defAmtOn,
      defAmt: (ckMaster && form.defAmtOn) ? defAmtNum : null,
      ckAmount: null,
      group,
      proxy: form.proxy,
      probeText: form.probeText,
    };
    recalcBalance(ns);
    sitesState.list.push(ns);
    return ns.name;
  }
  const target = findSite(editingName);
  if (!target) return editingName;
  target.name = form.name.trim();
  target.url = normHost(form.url);
  target.rechargeRmb = rmb;
  target.rechargeAmount = amt;
  target.group = group;
  target.proxy = form.proxy;
  target.probeText = form.probeText;
  target.rate = (rmb / amt).toFixed(2);
  target.cur = cur;
  target.email = form.email.trim();
  target.note = form.note;
  target.balNum = balNum;
  recalcBalance(target);
  target.ck = ckMaster ? (target.ck === 'signed' ? 'signed' : 'manual') : 'off';
  target.autoCheckin = ckMaster && form.autoOn;
  target.defAmtEnabled = ckMaster && form.defAmtOn;
  target.defAmt = (ckMaster && form.defAmtOn) ? defAmtNum : null;
  if (form.token) target.hasToken = true;
  return target.name;
}

// 充值：更新汇率（按本次充值人民币/到账重算 ratio→rate）+ 到账额累加到余额
export function rechargeSite(name: string, rmb: number, amt: number): boolean {
  const s = findSite(name);
  if (!s || !(rmb > 0) || !(amt > 0)) return false;
  s.rechargeRmb = rmb;
  s.rechargeAmount = amt;
  s.rate = (rmb / amt).toFixed(2);
  s.balNum = (s.balNum == null || isNaN(s.balNum)) ? amt : (s.balNum + amt);
  recalcBalance(s);
  return true;
}

// 全部爬取：对所有有 token 的站执行 scrapeSite
export function scrapeAll(): number {
  let n = 0;
  sitesState.list.forEach((s) => { if (s.hasToken) { scrapeSite(s.name); n++; } });
  return n;
}

// 签到徽章数据（视图渲染用）
export function badgeAmount(s: Site): string {
  if (s.ck === 'signed' && s.ckAmount != null && (s.ckAmount as unknown) !== '') {
    return ' +' + curSign(s.cur) + Number(s.ckAmount).toFixed(2);
  }
  return '';
}
