// 设置页 store（Phase I）：通用偏好 + 签到默认 等杂项全局设置。
// 前端 mock，落 localStorage。分页显隐复用 sites store（那里是表格事实来源）；
// 部署平台复用 ui store（sidebar 平台门控事实来源）。本 store 只管其余零散设置。
import { reactive } from 'vue';

const CURRENCY_KEY = 'rrelaynest-setting-currency';
const CHECKIN_DEFAULT_KEY = 'rrelaynest-setting-checkin-default';
const TIMEZONE_KEY = 'rrelaynest-setting-timezone';

interface SettingsState {
  currency: string;           // 默认货币显示（展示性，mock 不驱动实际换算）
  checkinDefaultOn: boolean;  // 新增站点默认开启签到
  timezone: string;           // 跨天重置时区
}

export const settingsState = reactive<SettingsState>({
  currency: localStorage.getItem(CURRENCY_KEY) || 'RMB（折算）',
  checkinDefaultOn: localStorage.getItem(CHECKIN_DEFAULT_KEY) === '1',
  timezone: localStorage.getItem(TIMEZONE_KEY) || 'Asia/Shanghai (UTC+8)',
});

export function persistCurrency(): void {
  try { localStorage.setItem(CURRENCY_KEY, settingsState.currency); } catch { /* noop */ }
}
export function persistTimezone(): void {
  try { localStorage.setItem(TIMEZONE_KEY, settingsState.timezone); } catch { /* noop */ }
}
export function setCheckinDefault(on: boolean): void {
  settingsState.checkinDefaultOn = on;
  try { localStorage.setItem(CHECKIN_DEFAULT_KEY, on ? '1' : '0'); } catch { /* noop */ }
}
