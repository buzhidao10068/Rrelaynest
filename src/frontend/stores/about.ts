// 关于/版本更新（Phase K → 块8 接后端 /api/update/check）：版本比对 + 检查更新 + 自动检查开关。
// 机制：后端代理 GitHub Releases（version.ts），返回 {current, latest, has_update, upgrade_steps, error?}——
// 版本比对与平台升级步骤都由后端权威给出（后端知道自己的 appVersion / platform）。前端只展示。
// 不做应用内自更新，只通知 + 给对应平台升级命令。自动检查开关落每用户 settings(update_auto_check)。
import { reactive } from 'vue';
import { api } from '@/api';

export const GITHUB_REPO = 'buzhidao10068/Rrelaynest';
export const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;

// GitHub releases/latest 的最小字段（与后端 version.ts LatestRelease 对齐）。
export interface Release {
  tag_name: string;
  published_at: string;
  body: string;
  html_url: string;
}

// /api/update/check 的返回体（与后端 version.ts UpdateCheckResult 对齐）。
interface UpdateCheckResult {
  current: string;
  latest: Release | null;
  has_update: boolean;
  upgrade_steps: string[];
  error?: string;
}

interface AboutState {
  current: string;          // 后端注入的当前应用版本（'' = 尚未载入）
  latest: Release | null;   // 检查后填充的最新版本（null = 尚未检查/无结果）
  hasUpdate: boolean;       // 后端权威：远端 tag 高于本地版本
  upgradeSteps: string[];   // 后端按平台给的升级命令
  autoUpdate: boolean;      // 自动检查开关（落 settings.update_auto_check）
  checking: boolean;
  error: string | null;     // 检查失败原因（网络/限流）；有值时 UI 提示「检查失败」
}

export const aboutState = reactive<AboutState>({
  current: '',
  latest: null,
  hasUpdate: false,
  upgradeSteps: [],
  autoUpdate: true,
  checking: false,
  error: null,
});

// 是否有新版（后端权威）
export function hasNewVersion(): boolean {
  return aboutState.hasUpdate && aboutState.latest != null;
}

// 手动/自动检查更新：GET /api/update/check。后端不抛——网络/限流失败时返回 error 字段。
// 返回结果供 UI 触发 toast。
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  aboutState.checking = true;
  try {
    const res = await api.get<UpdateCheckResult>('/api/update/check');
    aboutState.current = res.current;
    aboutState.latest = res.latest;
    aboutState.hasUpdate = res.has_update;
    aboutState.upgradeSteps = res.upgrade_steps;
    aboutState.error = res.error ?? null;
    return res;
  } finally {
    aboutState.checking = false;
  }
}

// 进入关于页：读自动检查开关（settings.update_auto_check，缺省视为开）；开启则静默查一次。
export async function loadAbout(): Promise<void> {
  const { settings } = await api.get<{ settings: Record<string, string> }>('/api/settings');
  aboutState.autoUpdate = settings.update_auto_check !== '0';
  if (aboutState.autoUpdate) await checkForUpdate();
}

// 切自动检查开关：写每用户 settings。
export async function setAutoUpdate(on: boolean): Promise<void> {
  await api.put('/api/settings', { update_auto_check: on ? '1' : '0' });
  aboutState.autoUpdate = on;
}
