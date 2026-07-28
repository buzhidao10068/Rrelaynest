// 测活词池（接后端 /api/probe-words，每用户隔离，见 0003 迁移）。
// id 为 CRUD 主键；text 仍是站点绑定键（sites.probe_text 单值绑定某 text）。
// 全局默认词/开关走每用户 settings(probe_global_text / probe_global_enabled)，非本表。
// 服务端缓存：任何变更后 reload；改名/删除的级联由后端在 batch 内完成。
import { reactive } from 'vue';
import { api } from '@/api';
import { sitesState, loadSites } from '@/stores/sites';

export interface ProbeWord {
  id: number;
  text: string;
  enabled: boolean;
}

interface ProbeWordApiRow {
  id: number;
  user_id: number;
  text: string;
  enabled: number;
  created_at: number;
  updated_at: number;
}

interface ProbeState {
  words: ProbeWord[];
  globalText: string;
  globalEnabled: boolean;
}

export const probeState = reactive<ProbeState>({
  words: [],
  globalText: 'hi',
  // 全局默认词开关：关闭后未单独绑词的站点渠道测试跳过（测试连接不受影响）。默认开。
  globalEnabled: true,
});

// 全局词必须指向一个启用中的词条，否则回落到第一条启用词，再兜底 hi。
// 仅本地显示兜底（Reka Select 拒绝空串值）；实际持久化只在 setGlobalProbe 时发生。
function normalizeGlobal(): void {
  if (!probeState.words.some((w) => w.text === probeState.globalText && w.enabled)) {
    const first = probeState.words.find((w) => w.enabled);
    probeState.globalText = first ? first.text : 'hi';
  }
}

// ---- 载入（GET /api/probe-words + 从 /api/settings 读全局词/开关）----
export async function loadProbeWords(): Promise<void> {
  const [{ words }, { settings }] = await Promise.all([
    api.get<{ words: ProbeWordApiRow[] }>('/api/probe-words'),
    api.get<{ settings: Record<string, string> }>('/api/settings'),
  ]);
  probeState.words = words.map((w) => ({ id: w.id, text: w.text, enabled: !!w.enabled }));
  probeState.globalText = settings.probe_global_text || 'hi';
  probeState.globalEnabled = settings.probe_global_enabled !== '0';
  normalizeGlobal();
}

export function probeUsable(text: string): boolean {
  return probeState.words.some((w) => w.text === text && w.enabled);
}

// 某站实际生效的测活词（仅用于渠道测试）：单站绑定优先；否则全局默认词，
// 但全局开关关闭时未绑词的站点返回空串，表示该站渠道测试跳过（测试连接不受影响）。
export function effectiveProbe(siteProbe?: string): string {
  if (siteProbe && probeUsable(siteProbe)) return siteProbe;
  if (probeState.globalEnabled && probeUsable(probeState.globalText)) return probeState.globalText;
  return '';
}

// ---- 查询 ----
export function findProbe(id: number): ProbeWord | undefined {
  return probeState.words.find((w) => w.id === id);
}
// 重名校验（编辑时用 excludeId 排除自身）。用于弹窗提交前的本地即时反馈；后端仍会 409 兜底。
export function probeExists(text: string, excludeId: number | null): boolean {
  return probeState.words.some((w) => w.text === text && w.id !== excludeId);
}
// 绑定到某测活词的站点数（词条卡片「配置站点」徽章）
export function probeSiteCount(text: string): number {
  return sitesState.list.filter((s) => s.probeText === text).length;
}

// ---- 全局默认词（写 /api/settings）----
export async function setGlobalProbe(text: string): Promise<void> {
  const t = (text || '').trim() || 'hi';
  await api.put('/api/settings', { probe_global_text: t });
  probeState.globalText = t;
}
// 全局默认词开关：关闭后未单独绑词的站点渠道测试跳过。
export async function setGlobalEnabled(on: boolean): Promise<void> {
  await api.put('/api/settings', { probe_global_enabled: on ? '1' : '0' });
  probeState.globalEnabled = on;
}

// ---- CRUD ----
// 新增/编辑：编辑传 id；新增传 null。改名的级联（sites.probe_text / 全局默认词）由后端处理，
// 故成功后同时 reload 词池、站点列表与全局设置。
export async function saveProbe(text: string, editingId: number | null): Promise<void> {
  if (editingId != null) {
    await api.put(`/api/probe-words/${editingId}`, { text });
  } else {
    await api.post('/api/probe-words', { text });
  }
  await Promise.all([loadProbeWords(), loadSites()]);
}

// 切换启用位。停用的若正是全局默认词，后端会清空该 setting；reload 后本地 normalize 兜底显示。
// 返回切换后的 enabled 态（null=词不存在）。
export async function toggleProbe(id: number): Promise<boolean | null> {
  const w = findProbe(id);
  if (!w) return null;
  const next = !w.enabled;
  await api.put(`/api/probe-words/${id}`, { enabled: next });
  await loadProbeWords();
  return next;
}

// 删除：后端解绑引用它的站点（probe_text 置 NULL 回落全局）+ 若是全局默认词则清空 setting。
export async function deleteProbe(id: number): Promise<boolean> {
  if (!findProbe(id)) return false;
  await api.del(`/api/probe-words/${id}`);
  await Promise.all([loadProbeWords(), loadSites()]);
  return true;
}

// ---- 站点 ↔ 测活词绑定（测活页「配置站点」弹窗保存，按 id）----
// checkedIds 站点绑定此词；取消勾选且原本绑的是此词 → 清空(probe_text='' 回落全局)。
// 逐个 PUT /api/sites/:id { probe_text } 后 reload 站点列表。返回绑定数。
export async function assignSitesToProbe(text: string, checkedIds: Set<number>): Promise<number> {
  let cnt = 0;
  for (const s of sitesState.list) {
    if (checkedIds.has(s.id)) {
      if (s.probeText !== text) await api.put(`/api/sites/${s.id}`, { probe_text: text });
      cnt++;
    } else if (s.probeText === text) {
      await api.put(`/api/sites/${s.id}`, { probe_text: '' });
    }
  }
  await loadSites();
  return cnt;
}
