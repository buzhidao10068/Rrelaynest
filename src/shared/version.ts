// 语义版本比较 + GitHub Releases 更新检查：平台无关，供 /api/update/check 使用。
// 与前端 src/frontend/stores/about.ts 的 cmpVersion 同义（容错非数字段、忽略前缀 v）。
import type { FetchLike } from './types.js';

import type { FetchLike } from './types.js';

// a>b 返回 1，a<b 返回 -1，相等 0。容错：非数字段按 0，忽略大小写前缀 v。
export function cmpVersion(a: string, b: string): number {
  const parse = (s: string): number[] =>
    String(s)
      .trim()
      .replace(/^v/i, '')
      .split('.')
      .map((x) => parseInt(x, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

// GitHub releases/latest 的最小字段（我们只用这三个）。
export interface LatestRelease {
  tag_name: string;
  published_at: string;
  body: string;
  html_url: string;
}

// /api/update/check 的返回体。has_update = 远端 tag 高于本地版本。
// 升级步骤按平台给命令（Workers/Docker 都不做应用内自更新，仅提示手动升级——见 memory update-check-backend-todo）。
export interface UpdateCheckResult {
  current: string;
  latest: LatestRelease | null;
  has_update: boolean;
  upgrade_steps: string[];
  error?: string;
}

// 按平台返回升级命令（不做应用内自更新，只展示手动步骤）。
export function upgradeSteps(platform: string): string[] {
  if (platform === 'workers') {
    return ['git pull', 'npm ci', 'npm run build', 'npx wrangler deploy'];
  }
  // 默认 Node/Docker
  return ['docker compose pull', 'docker compose up -d'];
}

// 后端代理 GitHub Releases：查 repo 的 releases/latest，与本地版本比对。
// fetchImpl 可注入（测试/代理），默认全局 fetch。不抛异常——网络/限流失败时返回 error 字段，
// 前端据此提示「检查失败」而非崩溃。GitHub API 要求 User-Agent 头，否则 403。
export async function fetchLatestRelease(
  repo: string,
  currentVersion: string,
  platform: string,
  fetchImpl?: FetchLike,
): Promise<UpdateCheckResult> {
  const doFetch = (fetchImpl ?? fetch) as FetchLike;
  const steps = upgradeSteps(platform);
  const base: UpdateCheckResult = {
    current: currentVersion,
    latest: null,
    has_update: false,
    upgrade_steps: steps,
  };
  try {
    const resp = await doFetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'rrelaynest-update-check' },
    });
    if (!resp.ok) {
      return { ...base, error: `GitHub API 返回 HTTP ${resp.status}` };
    }
    const data = (await resp.json()) as Partial<LatestRelease> | null;
    const tag = data?.tag_name;
    if (!tag) return { ...base, error: 'GitHub 未返回 tag_name' };
    const latest: LatestRelease = {
      tag_name: tag,
      published_at: data?.published_at ?? '',
      body: data?.body ?? '',
      html_url: data?.html_url ?? `https://github.com/${repo}/releases`,
    };
    return {
      ...base,
      latest,
      has_update: cmpVersion(tag, currentVersion) > 0,
    };
  } catch (err) {
    return { ...base, error: `检查更新失败：${err instanceof Error ? err.message : String(err)}` };
  }
}
