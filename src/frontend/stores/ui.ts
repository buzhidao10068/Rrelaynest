// 全局 UI 状态：当前视图（view-router）、抽屉开合、部署平台。
// 用轻量 reactive 单例（不引 Pinia）；各组件 import 同一个对象即共享。
import { reactive } from 'vue';

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
export type DeployPlatform = 'node' | 'workers';

interface UiState {
  view: ViewName;
  deployPlatform: DeployPlatform;
}

const PLATFORM_KEY = 'rrelaynest-platform';

function loadPlatform(): DeployPlatform {
  const v = localStorage.getItem(PLATFORM_KEY);
  return v === 'workers' ? 'workers' : 'node';
}

export const ui = reactive<UiState>({
  view: 'login',
  deployPlatform: loadPlatform(),
});

export function showView(v: ViewName): void {
  ui.view = v;
}

export function setDeployPlatform(p: DeployPlatform): void {
  ui.deployPlatform = p;
  localStorage.setItem(PLATFORM_KEY, p);
}
