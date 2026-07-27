// 测活页检测状态与逻辑（单例）。抽成 composable 是为了让平铺/分组两种视图复用同一个
// 行组件 SiteCheckRow，且共享同一份 connResults/modelResults/busySites 与检测函数。
// 检测为「浏览器直连」真调（见 useUpstream）——种子假域名必然失败，属预期。
import { ref, reactive } from 'vue';
import { effectiveProbe } from '@/stores/probes';
import { sitesState, type Site } from '@/stores/sites';
import { testConnectivity, testChannelModel } from '@/composables/useUpstream';
import { toast } from '@/composables/useToast';

export type ConnStatus = 'ok' | 'slow' | 'down' | 'checking';
// 整体渠道态：ok=至少一个模型可用 / down=全部不可用 / checking=测试中 / skipped=无模型可测或未绑词且全局关
export type ModelStatus = 'ok' | 'down' | 'checking' | 'skipped';
export type ModelDetailStatus = 'ok' | 'down' | 'checking';
export interface ModelDetail { id: string; status: ModelDetailStatus; }

export const connResults = reactive<Record<string, { status: ConnStatus; ms: number }>>({});
export const modelResults = reactive<Record<string, { status: ModelStatus; probe: string; models: ModelDetail[] }>>({});
export const running = ref(false);
// 单站测试进行中的站名（禁用该行按钮，避免重复触发）
export const busySites = reactive<Set<string>>(new Set());

// ---- 徽章样式/文案 ----
export function connBadgeClass(st: ConnStatus): string {
  if (st === 'ok') return 'bg-green-500/15 text-green-600 dark:text-green-400';
  if (st === 'slow') return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
  if (st === 'down') return 'bg-red-500/15 text-red-500';
  return 'bg-blue-500/15 text-blue-600 dark:text-blue-400';
}
export function connBadgeText(r?: { status: ConnStatus; ms: number }): string {
  if (!r) return '连接 待检';
  if (r.status === 'ok') return `● 正常 ${r.ms}ms`;
  if (r.status === 'slow') return `● 较慢 ${r.ms}ms`;
  if (r.status === 'down') return '● 不可达';
  return '● 连接中…';
}
export function modelBadgeClass(st: ModelStatus): string {
  if (st === 'ok') return 'bg-green-500/15 text-green-600 dark:text-green-400';
  if (st === 'down') return 'bg-red-500/15 text-red-500';
  if (st === 'skipped') return 'bg-muted text-muted-foreground';
  return 'bg-blue-500/15 text-blue-600 dark:text-blue-400';
}
export function modelBadgeText(r?: { status: ModelStatus; probe: string; models: ModelDetail[] }): string {
  if (!r) return '渠道 待检';
  const p = r.probe ? ` · ${r.probe}` : '';
  const okN = r.models.filter((m) => m.status === 'ok').length;
  const tot = r.models.length;
  const cnt = tot ? ` ${okN}/${tot}` : '';
  if (r.status === 'ok') return `● 可用${cnt}${p}`;
  if (r.status === 'down') return `● 不可用${cnt}${p}`;
  if (r.status === 'skipped') return '○ 未测（无模型或无测活词）';
  return `● 测试中…${cnt}`;
}
// 单个模型 chip 的绿/红/蓝
export function modelChipClass(st: ModelDetailStatus): string {
  if (st === 'ok') return 'bg-green-500/15 text-green-600 dark:text-green-400';
  if (st === 'down') return 'bg-red-500/15 text-red-500';
  return 'bg-blue-500/15 text-blue-600 dark:text-blue-400';
}

// ---- 测试连接（真调 {base}/v1/models 计时；假域名/CORS 会失败并标不可达，属预期）----
async function checkOneConnectivity(s: Site) {
  connResults[s.name] = { status: 'checking', ms: 0 };
  const r = await testConnectivity(s.url, s.token || '');
  let st: ConnStatus;
  if (!r.ok) st = 'down';
  else if (r.ms > 550) st = 'slow';
  else st = 'ok';
  connResults[s.name] = { status: st, ms: r.ms };
}

// scope=站名 → 只测该站一行（其余结果不动）；无 scope → 清空后逐站串行。
export async function runConnectivityCheck(scope?: string) {
  const list = scope ? sitesState.list.filter((s) => s.name === scope) : sitesState.list;
  if (!list.length) return;
  if (scope) {
    if (busySites.has(scope)) return;
    busySites.add(scope);
    try { await checkOneConnectivity(list[0]); } finally { busySites.delete(scope); }
    return;
  }
  if (running.value) return;
  running.value = true;
  Object.keys(connResults).forEach((k) => delete connResults[k]);
  try {
    for (const s of list) await checkOneConnectivity(s);
    const down = list.filter((s) => connResults[s.name]?.status === 'down').length;
    toast(down ? `连接检测完成，${down} 个站点不可达` : '连接检测完成，全部站点可达', down ? 'error' : 'success');
  } finally {
    running.value = false;
  }
}

// ---- 渠道测试（真调 {base}/v1/chat/completions，逐模型发测活词判可用）----
// 整体态：≥1 模型可用→ok；全不可用→down；无模型可测或未绑词且全局关→skipped。
async function checkOneModel(s: Site): Promise<ModelStatus> {
  const probe = effectiveProbe(s.probeText);
  const list = s.models ?? [];
  if (!probe || !list.length) {
    modelResults[s.name] = { status: 'skipped', probe: probe || '', models: [] };
    return 'skipped';
  }
  const details: ModelDetail[] = list.map((id) => ({ id, status: 'checking' as ModelDetailStatus }));
  modelResults[s.name] = { status: 'checking', probe, models: details };
  for (const d of details) {
    const r = await testChannelModel(s.url, s.token || '', d.id, probe);
    d.status = r.ok ? 'ok' : 'down';
  }
  const anyOk = details.some((d) => d.status === 'ok');
  const overall: ModelStatus = anyOk ? 'ok' : 'down';
  modelResults[s.name] = { status: overall, probe, models: details };
  return overall;
}

export async function runModelCheck(scope?: string) {
  const list = scope ? sitesState.list.filter((s) => s.name === scope) : sitesState.list;
  if (!list.length) return;
  if (scope) {
    if (busySites.has(scope)) return;
    busySites.add(scope);
    try { await checkOneModel(list[0]); } finally { busySites.delete(scope); }
    return;
  }
  if (running.value) return;
  running.value = true;
  Object.keys(modelResults).forEach((k) => delete modelResults[k]);
  try {
    let down = 0;
    for (const s of list) { if ((await checkOneModel(s)) === 'down') down++; }
    toast(down ? `渠道测试完成，${down} 个站点全部模型不可用` : '渠道测试完成', down ? 'error' : 'success');
  } finally {
    running.value = false;
  }
}
