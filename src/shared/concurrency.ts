// 平台无关的并发窗口 + 退避重试小工具（爬取/签到批量执行用）。
// 无依赖，仅用原生 Promise/setTimeout，Workers 与 Node 通用。
// 关联：[[scraper-backend-concurrency-todo]]（爬虫设置页的并发/超时/重试后端实现）。

// 以受限并发跑一批任务：任意时刻最多 limit 个在飞。保持与输入等长、同序的结果数组。
// mapper 不应抛出（调用方 scrapeAndStore/checkinAndStore 已各自吞掉异常返回 outcome）；
// 万一抛出，此处会让整个 Promise.all 拒绝——故调用方务必保证 mapper 不抛。
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length;
  const results = new Array<R>(n);
  if (n === 0) return results;

  // 并发上限至少为 1，且不超过任务数。
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, n));

  let next = 0;
  async function worker(): Promise<void> {
    // 每个 worker 抢下一个未处理的下标，直到取完。
    while (true) {
      const i = next++;
      if (i >= n) return;
      results[i] = await mapper(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: width }, () => worker()));
  return results;
}

// 退避重试：跑 fn，失败（抛异常）则重试，最多 retries 次额外尝试（共 retries+1 次）。
// 第 k 次重试前等 baseDelayMs * 2^(k-1)（指数退避，k 从 1 起）。retries<=0 时只跑一次。
// 全部失败则抛最后一次的异常。shouldRetry 可选：返回 false 则立即放弃（如不可重试的错误）。
export async function retryAsync<R>(
  fn: (attempt: number) => Promise<R>,
  opts: { retries: number; baseDelayMs?: number; shouldRetry?: (err: unknown) => boolean } = {
    retries: 0,
  },
): Promise<R> {
  const retries = Math.max(0, Math.floor(opts.retries) || 0);
  const baseDelayMs = opts.baseDelayMs ?? 300;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (opts.shouldRetry && !opts.shouldRetry(err)) break;
      if (attempt < retries) {
        const delay = baseDelayMs * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastErr;
}
