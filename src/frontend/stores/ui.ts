// 全局 UI 状态：当前视图（view-router）、抽屉开合、部署平台、服务端配置健康标记。
// 用轻量 reactive 单例（不引 Pinia）；各组件 import 同一个对象即共享。
import { reactive, computed } from 'vue';
import { api } from '../api';

export type ViewName =
  | 'login'
  | 'dashboard'
  | 'scraperCf'
  | 'scraperDocker'
  | 'activity'
  | 'proxy'
  | 'users'
  | 'userSites'
  | 'settings'
  | 'about';

// 部署平台：'node'=Node/Docker（代理生效） | 'workers'=Cloudflare（代理不可用）
// 后端权威：由 worker/server 两个入口注入 AppDeps.platform，经 GET /api/session 下发。
// 类型在前端重复声明（不 import src/shared，跨层禁令），后端为准。
export type DeployPlatform = 'node' | 'workers';

// 服务端配置健康标记：后端 /api/session 下发的枚举名（不含密钥等敏感内容）。
// 目前只有一个：ENCRYPTION_KEY 格式非法（须是 base64 的 32 字节）。
export const WARN_ENCRYPTION_KEY_INVALID = 'ENCRYPTION_KEY_INVALID';

// /api/session 响应中与平台/配置相关的部分（后端 src/shared/routes.ts 为权威）。
interface SessionPlatformResponse {
  platform?: DeployPlatform;
  configWarnings?: string[];
}

interface UiState {
  view: ViewName;
  // null = 尚未从后端得知。不落 localStorage：平台是部署期事实而非用户偏好，
  // 每次启动都问后端才不会在 Cloudflare 上错显 Docker。
  // （历史遗留键 'rrelaynest-platform' 已废弃，不再读写。）
  deployPlatform: DeployPlatform | null;
  // 后端下发的配置健康标记。与 deployPlatform 同款：部署期事实、只读、不落 localStorage、
  // 前端不自行推断（它看不到密钥，也无从判断合法性）。
  configWarnings: string[];
}

export const ui = reactive<UiState>({
  view: 'login',
  deployPlatform: null,
  configWarnings: [],
});

export function showView(v: ViewName): void {
  ui.view = v;
}

export function setDeployPlatform(p: DeployPlatform | null): void {
  ui.deployPlatform = p;
}

export function setConfigWarnings(w: string[] | undefined): void {
  ui.configWarnings = w ?? [];
}

// 派生选择器：加密密钥是否配置有误（登录页与主界面的常驻提示条都读它）。
export const encryptionKeyInvalid = computed(() =>
  ui.configWarnings.includes(WARN_ENCRYPTION_KEY_INVALID),
);

// 重新向后端确认部署平台（「自动检测」按钮与启动/登录流程共用）。
// 失败时保持原值并返回 null，由调用方决定如何提示。
export async function refreshPlatform(): Promise<DeployPlatform | null> {
  try {
    const s = await api.get<SessionPlatformResponse>('/api/session');
    setConfigWarnings(s.configWarnings); // 同一响应顺带刷新配置标记
    if (s.platform === 'workers' || s.platform === 'node') {
      setDeployPlatform(s.platform);
      return s.platform;
    }
    return null;
  } catch {
    return null;
  }
}
