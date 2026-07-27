// 爬虫设置 store（Phase H）：全局爬取行为设置，按平台分两套（Cloudflare Workers / Node·Docker）。
// 前端 mock，落 localStorage；后端对接见 [[scraper-backend-concurrency-todo]]（并发/超时/重试尚未落地）。
// 唯一事实来源：scraperState。单站可在编辑弹窗覆盖（本页只管全局默认）。
import { reactive } from 'vue';

const CF_KEY = 'rrelaynest-scraper-cf';
const DK_KEY = 'rrelaynest-scraper-dk';

// Cloudflare Workers：定时=Cron Triggers（wrangler.toml，运行时不可热改）；不支持代理；受平台硬限。
export interface CfScraperSettings {
  autoOn: boolean;
  cron: string;
  concurrency: number;   // 受 subrequest 上限约束，建议 ≤ 6
  timeout: number;       // 单站超时（秒），受 CPU 时间限制建议 ≤ 30
}

// Node/Docker：定时=node-cron（间隔可热改）；支持代理；并发/超时/重试自由配置。
export interface DkScraperSettings {
  autoOn: boolean;
  interval: number;                 // 爬取间隔数值
  intervalUnit: 'min' | 'hour';     // 间隔单位
  concurrency: number;
  timeout: number;                  // 单站超时（秒）
  retry: number;                    // 失败重试次数
}

const CF_DEFAULTS: CfScraperSettings = { autoOn: true, cron: '*/30 * * * *', concurrency: 3, timeout: 10 };
const DK_DEFAULTS: DkScraperSettings = { autoOn: true, interval: 30, intervalUnit: 'min', concurrency: 5, timeout: 15, retry: 1 };

function load<T>(key: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch { /* noop */ }
  return { ...defaults };
}

interface ScraperState {
  cf: CfScraperSettings;
  dk: DkScraperSettings;
}

export const scraperState = reactive<ScraperState>({
  cf: load(CF_KEY, CF_DEFAULTS),
  dk: load(DK_KEY, DK_DEFAULTS),
});

export function persistCf(): void {
  try { localStorage.setItem(CF_KEY, JSON.stringify(scraperState.cf)); } catch { /* noop */ }
}
export function persistDk(): void {
  try { localStorage.setItem(DK_KEY, JSON.stringify(scraperState.dk)); } catch { /* noop */ }
}

// Cron 表达式 → wrangler.toml 片段（只读，供复制）
export function cronSnippet(cron: string): string {
  return `[triggers]\ncrons = ["${cron}"]`;
}
