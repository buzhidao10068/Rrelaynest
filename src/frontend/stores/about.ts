// 关于/版本更新（Phase K）：版本比对 + 检查更新 mock + 自动检查开关。
// 机制（照搬 mock）：每个部署实例向 GitHub Releases 查最新 tag_name 与本地 APP_VERSION 比对；
// 有新版仅「通知 + 给对应平台升级步骤」，不做应用内自更新（Workers/Docker 都无权改自己的镜像/部署）。
// 块7 后端加 /api/update/check 代理 GitHub Releases API；此处 mock。
import { reactive } from 'vue';

export const APP_VERSION = 'v1.0.0';
export const GITHUB_REPO = 'buzhidao10068/Rrelaynest';
export const RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;

export interface Release {
  tag_name: string;
  published_at: string;
  body: string;
}

// mock：模拟 GitHub releases/latest 返回；块7 换成真实 fetch。
export const MOCK_LATEST: Release = {
  tag_name: 'v1.2.0',
  published_at: '2026-07-24',
  body:
    '- 新增出站代理池（http/https/socks5）\n' +
    '- 测活拆分为测试连接 + 渠道测试\n' +
    '- 爬虫设置按平台拆分\n' +
    '- 依赖安全升级，漏洞清零',
};

const AUTO_UPDATE_KEY = 'rrelaynest-auto-update';

interface AboutState {
  // 检查后填充的最新版本（null=尚未检查）
  latest: Release | null;
  autoUpdate: boolean;
  checking: boolean;
}

function loadAutoUpdate(): boolean {
  const v = localStorage.getItem(AUTO_UPDATE_KEY);
  return v === null ? true : v === 'true';
}

export const aboutState = reactive<AboutState>({
  latest: null,
  autoUpdate: loadAutoUpdate(),
  checking: false,
});

// 语义版本比较：a>b 返回 1，a<b 返回 -1，相等 0。容错非数字段。
export function cmpVersion(a: string, b: string): number {
  const pa = String(a).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

// 是否有新版（latest.tag_name > APP_VERSION）
export function hasNewVersion(): boolean {
  const l = aboutState.latest;
  return !!(l && l.tag_name && cmpVersion(l.tag_name, APP_VERSION) > 0);
}

// 手动/自动检查更新：演示端转圈一下再填 mock；块7 fetch /api/update/check。
// 返回 Promise，供 UI 触发 toast。
export function checkForUpdate(): Promise<Release> {
  aboutState.checking = true;
  return new Promise((resolve) => {
    setTimeout(() => {
      aboutState.latest = MOCK_LATEST;
      aboutState.checking = false;
      resolve(MOCK_LATEST);
    }, 700);
  });
}

// 自动检查开启时进入关于页即静默查一次（块7：登录时/后端定时）；此处直接填 mock 结果。
export function silentCheck(): void {
  if (aboutState.autoUpdate) aboutState.latest = MOCK_LATEST;
}

export function setAutoUpdate(on: boolean): void {
  aboutState.autoUpdate = on;
  localStorage.setItem(AUTO_UPDATE_KEY, on ? 'true' : 'false');
}
