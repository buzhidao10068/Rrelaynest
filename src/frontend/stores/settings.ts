// 设置页 store：杂项全局设置。
// - checkinDefaultOn / timezone：接后端 /api/settings（server-cache，每用户）。
//     · checkin_default_on ('1'|'0')：新增站点默认开启签到（SiteEditorModal 消费）
//     · reset_timezone (IANA 时区名)：跨天重置时区，后端 scheduler 用它算跨天
// - currency：纯前端展示偏好（后端不驱动换算），继续走 localStorage。
// - 分页显隐复用 sites store（表格事实来源）；部署平台复用 ui store（sidebar 事实来源）。
import { reactive } from 'vue';
import { api, ApiError } from '@/api';

const CURRENCY_KEY = 'rrelaynest-setting-currency';

// 后端 settings 键
const K_CHECKIN_DEFAULT = 'checkin_default_on';
const K_TIMEZONE = 'reset_timezone';

// 设置页分区 key（与 SettingsView 的导航一致）
export type SettingsSection = 'general' | 'security' | 'checkin' | 'records' | 'data' | 'privacy';

interface SettingsState {
  currency: string;           // 默认货币显示（纯前端，展示性）
  checkinDefaultOn: boolean;  // 新增站点默认开启签到（后端）
  timezone: string;           // 跨天重置时区，IANA 名（后端 scheduler 用）
  loaded: boolean;            // 是否已从后端加载过（避免 UI 闪一下默认值）
  // 跨页跳转请求打开的分区（如「用户管理」跳「协作与隐私」）；SettingsView 消费后清空。
  pendingSection: SettingsSection | null;
}

export const settingsState = reactive<SettingsState>({
  currency: localStorage.getItem(CURRENCY_KEY) || 'RMB（折算）',
  // 后端未加载前的兜底：与后端默认一致（关 / Asia/Shanghai），避免建站弹窗抢跑时行为漂移。
  checkinDefaultOn: false,
  timezone: 'Asia/Shanghai',
  loaded: false,
  pendingSection: null,
});

// 请求设置页打开某分区（SettingsView 挂载/激活时读取并清空）
export function requestSettingsSection(s: SettingsSection): void {
  settingsState.pendingSection = s;
}

// ---- currency（纯前端） ----
export function persistCurrency(): void {
  try { localStorage.setItem(CURRENCY_KEY, settingsState.currency); } catch { /* noop */ }
}

// ---- 后端 settings 读写 ----
interface SettingsResp { settings: Record<string, string> }

export async function loadSettings(): Promise<void> {
  try {
    const r = await api.get<SettingsResp>('/api/settings');
    const map = r.settings ?? {};
    settingsState.checkinDefaultOn = map[K_CHECKIN_DEFAULT] === '1';
    settingsState.timezone = map[K_TIMEZONE] || 'Asia/Shanghai';
    settingsState.loaded = true;
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
  }
}

async function putSetting(key: string, value: string): Promise<void> {
  await api.put('/api/settings', { [key]: value });
}

export async function setCheckinDefault(on: boolean): Promise<void> {
  settingsState.checkinDefaultOn = on;
  await putSetting(K_CHECKIN_DEFAULT, on ? '1' : '0');
}

export async function setTimezone(tz: string): Promise<void> {
  settingsState.timezone = tz;
  await putSetting(K_TIMEZONE, tz);
}
