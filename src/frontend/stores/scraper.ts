// 爬虫设置 store（Phase H → 块8 接后端 /api/settings）：全局爬取行为，按平台分两套视图。
// 后端只有一套每用户 settings 键；CF/DK 视图映射到共享键，一个部署只会用其中一页。
//   scrape_auto_enabled  定时爬取总开关（scheduler 据此 gate 爬取分支；缺省视为开）
//   scrape_concurrency   批量并发（readScrapeConfig 读）
//   scrape_timeout_sec   单站超时秒（readScrapeConfig 读）
//   scrape_retry         失败重试次数（readScrapeConfig 读，仅 DK 页面暴露）
//   scrape_interval_min  node-cron 节流间隔分钟（scheduler 读，仅 DK；CF 由 Cron Triggers 定时）
//   scrape_cron          CF 的 cron 文本，仅供生成 wrangler.toml 片段，无运行时效果（display-only）
// 服务端缓存：loadScraperSettings 从 /api/settings 回填；saveCf/saveDk 写回后不必 reload（本地已是权威副本）。
import { reactive } from 'vue';
import { api } from '@/api';

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

interface ScraperState {
  cf: CfScraperSettings;
  dk: DkScraperSettings;
}

export const scraperState = reactive<ScraperState>({
  cf: { ...CF_DEFAULTS },
  dk: { ...DK_DEFAULTS },
});

// 解析数值设置：非法/缺省回落默认。
function num(v: string | undefined, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
}

// scrape_interval_min → { interval, unit }：整小时且 ≥60 显示为小时，否则分钟。
function splitInterval(min: number): { interval: number; intervalUnit: 'min' | 'hour' } {
  if (min >= 60 && min % 60 === 0) return { interval: min / 60, intervalUnit: 'hour' };
  return { interval: min, intervalUnit: 'min' };
}
// { interval, unit } → scrape_interval_min
function joinInterval(interval: number, unit: 'min' | 'hour'): number {
  return Math.max(1, Math.round(unit === 'hour' ? interval * 60 : interval));
}

// ---- 载入（GET /api/settings 回填两套视图的共享键）----
export async function loadScraperSettings(): Promise<void> {
  const { settings } = await api.get<{ settings: Record<string, string> }>('/api/settings');
  const autoOn = settings.scrape_auto_enabled !== '0'; // 缺省视为开
  const concurrency = num(settings.scrape_concurrency, DK_DEFAULTS.concurrency);
  const timeout = num(settings.scrape_timeout_sec, DK_DEFAULTS.timeout);
  const retry = Number.isFinite(Number(settings.scrape_retry)) ? Number(settings.scrape_retry) : DK_DEFAULTS.retry;
  const { interval, intervalUnit } = splitInterval(num(settings.scrape_interval_min, 30));

  // 原地赋值（不换对象），保持视图里 `const dk = scraperState.dk` 的引用有效。
  Object.assign(scraperState.cf, {
    autoOn,
    cron: settings.scrape_cron || CF_DEFAULTS.cron,
    concurrency,
    timeout,
  });
  Object.assign(scraperState.dk, { autoOn, interval, intervalUnit, concurrency, timeout, retry });
}

// ---- 保存（PUT /api/settings，只写本视图涉及的键）----
export async function saveCf(): Promise<void> {
  const cf = scraperState.cf;
  await api.put('/api/settings', {
    scrape_auto_enabled: cf.autoOn ? '1' : '0',
    scrape_concurrency: String(cf.concurrency),
    scrape_timeout_sec: String(cf.timeout),
    scrape_cron: cf.cron,
  });
}

export async function saveDk(): Promise<void> {
  const dk = scraperState.dk;
  await api.put('/api/settings', {
    scrape_auto_enabled: dk.autoOn ? '1' : '0',
    scrape_interval_min: String(joinInterval(dk.interval, dk.intervalUnit)),
    scrape_concurrency: String(dk.concurrency),
    scrape_timeout_sec: String(dk.timeout),
    scrape_retry: String(Math.max(0, Math.round(dk.retry))),
  });
}

// Cron 表达式 → wrangler.toml 片段（只读，供复制）
export function cronSnippet(cron: string): string {
  return `[triggers]\ncrons = ["${cron}"]`;
}
