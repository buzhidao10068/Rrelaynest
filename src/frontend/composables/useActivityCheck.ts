// 测活页检测状态与逻辑（单例）。抽成 composable 是为了让平铺/分组两种视图复用同一个
// 行组件 SiteCheckRow，且共享同一份 connResults/modelResults/busySites 与检测函数。
//
// 块8 接线：检测不再走「浏览器直连」（受 CORS 约束、无法经代理），改调后端端点：
//  - 测连接：POST /api/sites/:id/ping        → { ok, status, latencyMs, message }
//  - 测渠道：POST /api/sites/:id/channel-test → { ok, message, model?, latencyMs }
//                                              或 { ok:false, skipped:true, message }（无有效测活词）
// 后端走站点绑定代理（resolveFetch），能测到浏览器直连测不到的站；「较慢」阈值由后端判（2000ms）。
// 结果字典改按站 id 索引（唯一主键），不再用 name（可能重名）。
import { ref, reactive } from 'vue';
import { effectiveProbe } from '@/stores/probes';
import { sitesState, type Site } from '@/stores/sites';
import { api, ApiError } from '@/api';
import { toast } from '@/composables/useToast';

export type ConnStatus = 'ok' | 'slow' | 'down' | 'checking';
// 整体渠道态：ok=至少一个模型可用 / down=全部不可用 / checking=测试中 / skipped=无模型可测或未绑词且全局关
export type ModelStatus = 'ok' | 'down' | 'checking' | 'skipped';
export type ModelDetailStatus = 'ok' | 'down' | 'checking';
export interface ModelDetail { id: string; status: ModelDetailStatus; }

export const connResults = reactive<Record<number, { status: ConnStatus; ms: number }>>({});
export const modelResults = reactive<Record<number, { status: ModelStatus; probe: string; models: ModelDetail[] }>>({});
export const running = ref(false);
// 单站测试进行中的站 id（禁用该行按钮，避免重复触发）
export const busySites = reactive<Set<number>>(new Set());

// 后端 ping 返回体（见 src/shared/scraper.ts PingResult）
interface PingResp { ok: boolean; status: number; latencyMs: number; message: string }
// 后端 channel-test 返回体（见 src/shared/scraper.ts ChannelTestResult；无有效测活词时含 skipped）
interface ChannelResp { ok: boolean; message: string; model?: string; latencyMs?: number; skipped?: boolean }

// 后端判「较慢」的阈值（与 scraper.ts SLOW_THRESHOLD_MS 对齐）。
const SLOW_THRESHOLD_MS = 2000;

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

// ---- 测试连接（POST /api/sites/:id/ping，后端走站点代理量耗时；网络错误由后端归一为 ok=false）----
async function checkOneConnectivity(s: Site) {
  connResults[s.id] = { status: 'checking', ms: 0 };
  try {
    const r = await api.post<PingResp>(`/api/sites/${s.id}/ping`);
    let st: ConnStatus;
    if (!r.ok) st = 'down';
    else if (r.latencyMs > SLOW_THRESHOLD_MS) st = 'slow';
    else st = 'ok';
    connResults[s.id] = { status: st, ms: r.latencyMs };
  } catch (e) {
    // 401 已由 api 层触发登出；其余（404 站点不存在等）标不可达。
    connResults[s.id] = { status: 'down', ms: 0 };
    if (e instanceof ApiError && e.status !== 401) toast(`「${s.name}」测连接失败：${e.message}`, 'error');
  }
}

// scope=站 id → 只测该站一行（其余结果不动）；无 scope → 清空后逐站串行。
export async function runConnectivityCheck(scope?: number) {
  const list = scope != null ? sitesState.list.filter((s) => s.id === scope) : sitesState.list;
  if (!list.length) return;
  if (scope != null) {
    if (busySites.has(scope)) return;
    busySites.add(scope);
    try { await checkOneConnectivity(list[0]); } finally { busySites.delete(scope); }
    return;
  }
  if (running.value) return;
  running.value = true;
  Object.keys(connResults).forEach((k) => delete connResults[Number(k)]);
  try {
    for (const s of list) await checkOneConnectivity(s);
    const down = list.filter((s) => connResults[s.id]?.status === 'down').length;
    toast(down ? `连接检测完成，${down} 个站点不可达` : '连接检测完成，全部站点可达', down ? 'error' : 'success');
  } finally {
    running.value = false;
  }
}

// ---- 渠道测试（POST /api/sites/:id/channel-test，后端逐模型发测活词判可用）----
// 后端一次测一个 model；此处对该站已爬到的模型逐个调用。测活词由后端解析，前端仅用
// effectiveProbe 计算展示文案 + 提前判「无词→skipped」（与后端解析逻辑一致，省一趟请求）。
// 整体态：≥1 模型可用→ok；全不可用→down；无模型可测或未绑词且全局关→skipped。
async function checkOneModel(s: Site): Promise<ModelStatus> {
  const probe = effectiveProbe(s.probeText);
  const list = s.models ?? [];
  if (!probe || !list.length) {
    modelResults[s.id] = { status: 'skipped', probe: probe || '', models: [] };
    return 'skipped';
  }
  const details: ModelDetail[] = list.map((id) => ({ id, status: 'checking' as ModelDetailStatus }));
  modelResults[s.id] = { status: 'checking', probe, models: details };
  for (const d of details) {
    try {
      const r = await api.post<ChannelResp>(`/api/sites/${s.id}/channel-test`, { model: d.id });
      // 后端判无有效测活词 → 整站 skipped（后续模型无需再测）。
      if (r.skipped) {
        modelResults[s.id] = { status: 'skipped', probe, models: [] };
        return 'skipped';
      }
      d.status = r.ok ? 'ok' : 'down';
    } catch (e) {
      d.status = 'down';
      if (e instanceof ApiError && e.status !== 401) toast(`「${s.name}」测渠道失败：${e.message}`, 'error');
    }
  }
  const anyOk = details.some((d) => d.status === 'ok');
  const overall: ModelStatus = anyOk ? 'ok' : 'down';
  modelResults[s.id] = { status: overall, probe, models: details };
  return overall;
}

export async function runModelCheck(scope?: number) {
  const list = scope != null ? sitesState.list.filter((s) => s.id === scope) : sitesState.list;
  if (!list.length) return;
  if (scope != null) {
    if (busySites.has(scope)) return;
    busySites.add(scope);
    try { await checkOneModel(list[0]); } finally { busySites.delete(scope); }
    return;
  }
  if (running.value) return;
  running.value = true;
  Object.keys(modelResults).forEach((k) => delete modelResults[Number(k)]);
  try {
    let down = 0;
    for (const s of list) { if ((await checkOneModel(s)) === 'down') down++; }
    toast(down ? `渠道测试完成，${down} 个站点全部模型不可用` : '渠道测试完成', down ? 'error' : 'success');
  } finally {
    running.value = false;
  }
}
