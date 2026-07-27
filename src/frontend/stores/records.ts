// 记录 store（Phase I）：充值 / 签到 / 爬取三类历史流水。
// 演示端仅存本次会话（内存 reactive，不落 localStorage，对齐 mock「演示端仅存本次会话」）。
// 由 sites store 的 rechargeSite / applyCheckin / scrapeSite 写入。
import { reactive } from 'vue';

export interface RechargeRec { site: string; rmb: number; amount: number; cur?: string; ts: number; }
export interface CheckinRec { site: string; amount: number; cur?: string; ts: number; }
export interface ScrapeRec { site: string; ok: boolean; balance?: number; cur?: string; ts: number; }

interface RecordsState {
  recharge: RechargeRec[];
  checkin: CheckinRec[];
  scrape: ScrapeRec[];
}

// 新记录插到最前（时间倒序，最新在上）
export const recordsState = reactive<RecordsState>({
  recharge: [],
  checkin: [],
  scrape: [],
});

export function logRecharge(rec: RechargeRec): void {
  recordsState.recharge.unshift(rec);
}
export function logCheckin(rec: CheckinRec): void {
  recordsState.checkin.unshift(rec);
}
export function logScrape(rec: ScrapeRec): void {
  recordsState.scrape.unshift(rec);
}

// 「MM-DD HH:mm」时间格式（对齐 mock 的 fmtTs）
export function fmtTs(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => (n < 10 ? '0' : '') + n;
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
