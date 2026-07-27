// 测活词池（Phase E 起：编辑弹窗的测活词下拉需要它；完整测活页在 Phase G）。
// text 为唯一键；站点以 site.probeText=某 text 单值绑定。词条列表 + 全局默认词落 localStorage。
import { reactive } from 'vue';
import { sitesState } from '@/stores/sites';

export interface ProbeWord {
  text: string;
  enabled: boolean;
}

const PROBES_KEY = 'rrelaynest-probes';
const GLOBAL_KEY = 'rrelaynest-probe-global';
const GLOBAL_ON_KEY = 'rrelaynest-probe-global-on';

const DEFAULT_PROBE_WORDS: ProbeWord[] = [
  { text: 'hi', enabled: true },
  { text: '你好', enabled: true },
  { text: 'ping', enabled: true },
];

function loadWords(): ProbeWord[] {
  try {
    const raw = localStorage.getItem(PROBES_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch { /* noop */ }
  return DEFAULT_PROBE_WORDS.slice();
}

interface ProbeState {
  words: ProbeWord[];
  globalText: string;
  globalEnabled: boolean;
}

export const probeState = reactive<ProbeState>({
  words: loadWords(),
  globalText: localStorage.getItem(GLOBAL_KEY) || 'hi',
  // 全局默认词开关：关闭后未单独绑词的站点渠道测试跳过（测试连接不受影响）。默认开。
  globalEnabled: localStorage.getItem(GLOBAL_ON_KEY) !== '0',
});

// 全局词必须指向一个启用中的词条，否则回落到第一条启用词，再兜底 hi
function normalizeGlobal(): void {
  if (!probeState.words.some((w) => w.text === probeState.globalText && w.enabled)) {
    const first = probeState.words.find((w) => w.enabled);
    probeState.globalText = first ? first.text : 'hi';
  }
}
normalizeGlobal();

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

export function persistProbes(): void {
  try {
    localStorage.setItem(PROBES_KEY, JSON.stringify(probeState.words));
    localStorage.setItem(GLOBAL_KEY, probeState.globalText);
    localStorage.setItem(GLOBAL_ON_KEY, probeState.globalEnabled ? '1' : '0');
  } catch { /* noop */ }
}

// ---- 查询 ----
export function findProbe(text: string): ProbeWord | undefined {
  return probeState.words.find((w) => w.text === text);
}
// 重名校验（编辑时用 exclude 排除自身）
export function probeExists(text: string, exclude: string | null): boolean {
  return probeState.words.some((w) => w.text === text && w.text !== exclude);
}
// 绑定到某测活词的站点数（词条卡片「配置站点」徽章）
export function probeSiteCount(text: string): number {
  return sitesState.list.filter((s) => s.probeText === text).length;
}

// ---- 全局默认词 ----
export function setGlobalProbe(text: string): void {
  probeState.globalText = (text || '').trim() || 'hi';
}
// 全局默认词开关：关闭后未单独绑词的站点渠道测试跳过。
export function setGlobalEnabled(on: boolean): void {
  probeState.globalEnabled = on;
}

// ---- CRUD ----
// 新增/编辑：edit 传原文本（editingText）；新增传 null。改名会级联同步 sites[].probeText 与 globalText。
export function saveProbe(text: string, editingText: string | null): void {
  if (editingText != null) {
    const ex = findProbe(editingText);
    if (!ex) return;
    const oldText = ex.text;
    ex.text = text;
    if (oldText !== text) {
      sitesState.list.forEach((s) => { if (s.probeText === oldText) s.probeText = text; });
      if (probeState.globalText === oldText) probeState.globalText = text;
    }
  } else {
    probeState.words.push({ text, enabled: true });
  }
  persistProbes();
}

// 切换启用位；停用的若正是全局默认词，则回落第一条启用词，再兜底 hi。返回切换后的 enabled 态。
export function toggleProbe(text: string): boolean | null {
  const w = findProbe(text);
  if (!w) return null;
  w.enabled = !w.enabled;
  if (!w.enabled && probeState.globalText === text) {
    const first = probeState.words.find((x) => x.enabled);
    probeState.globalText = first ? first.text : 'hi';
  }
  persistProbes();
  return w.enabled;
}

// 删除：清空绑定它的站点（回落跟随全局）+ 若是全局默认词则回落第一条启用词。
export function deleteProbe(text: string): boolean {
  const idx = probeState.words.findIndex((w) => w.text === text);
  if (idx < 0) return false;
  sitesState.list.forEach((s) => { if (s.probeText === text) s.probeText = ''; });
  probeState.words.splice(idx, 1);
  if (probeState.globalText === text) {
    const first = probeState.words.find((x) => x.enabled);
    probeState.globalText = first ? first.text : 'hi';
  }
  persistProbes();
  return true;
}

// ---- 站点 ↔ 测活词绑定（测活页「配置站点」弹窗保存）----
// checked 站点绑定此词；取消勾选且原本绑的是此词 → 清空（回落跟随全局）。返回绑定数。
export function assignSitesToProbe(text: string, checkedNames: Set<string>): number {
  let cnt = 0;
  sitesState.list.forEach((s) => {
    if (checkedNames.has(s.name)) { s.probeText = text; cnt++; }
    else if (s.probeText === text) { s.probeText = ''; }
  });
  return cnt;
}
