// 测活词池（Phase E 起：编辑弹窗的测活词下拉需要它；完整测活页在 Phase G）。
// text 为唯一键；站点以 site.probeText=某 text 单值绑定。词条列表 + 全局默认词落 localStorage。
import { reactive } from 'vue';

export interface ProbeWord {
  text: string;
  enabled: boolean;
}

const PROBES_KEY = 'rrelaynest-probes';
const GLOBAL_KEY = 'rrelaynest-probe-global';

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
}

export const probeState = reactive<ProbeState>({
  words: loadWords(),
  globalText: localStorage.getItem(GLOBAL_KEY) || 'hi',
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

// 某站实际生效的测活词：单站绑定优先，否则全局
export function effectiveProbe(siteProbe?: string): string {
  if (siteProbe && probeUsable(siteProbe)) return siteProbe;
  if (probeUsable(probeState.globalText)) return probeState.globalText;
  return 'hi';
}

export function persistProbes(): void {
  try {
    localStorage.setItem(PROBES_KEY, JSON.stringify(probeState.words));
    localStorage.setItem(GLOBAL_KEY, probeState.globalText);
  } catch { /* noop */ }
}
