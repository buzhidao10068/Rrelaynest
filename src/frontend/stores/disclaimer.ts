// 免责声明门禁 store（07-31）：per-user 同意态，存服务端 settings 的 disclaimer_accepted 键。
// 登录后、进主面板前由 App/LoginView 触发 loadDisclaimer；未同意则 App 渲染 DisclaimerGate 全屏拦截。
// 复用现有 /api/settings（任意每用户键 upsert），无需后端改动。
import { reactive } from 'vue';
import { api, ApiError } from '@/api';

const K_ACCEPTED = 'disclaimer_accepted';

interface DisclaimerState {
  accepted: boolean; // 该账号是否已同意免责声明
  loaded: boolean;   // 是否已从后端读过（门禁判定前避免闪现主面板/门禁）
}

export const disclaimerState = reactive<DisclaimerState>({
  accepted: false,
  loaded: false,
});

// 从后端回读同意态。401（未登录）吞掉、保持未加载；其余错误抛出交调用方处理。
export async function loadDisclaimer(): Promise<void> {
  try {
    const r = await api.get<{ settings: Record<string, string> }>('/api/settings');
    disclaimerState.accepted = (r.settings ?? {})[K_ACCEPTED] === '1';
    disclaimerState.loaded = true;
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return; // 未登录：留待登录后再读
    throw e;
  }
}

// 写入同意态（成功后本地置 accepted，App 反应式放行进主面板）。
export async function acceptDisclaimer(): Promise<void> {
  await api.put('/api/settings', { [K_ACCEPTED]: '1' });
  disclaimerState.accepted = true;
}

// 登出时重置，避免换账号串号（由 users.clearSession 调用，覆盖侧栏登出/401 失效/登出所有设备）。
export function resetDisclaimerState(): void {
  disclaimerState.accepted = false;
  disclaimerState.loaded = false;
}
