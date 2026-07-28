// Node/Docker 专属：把一条代理配置转成「绑定该代理的 fetch」，供 scraper 注入。
// 仅本文件依赖 undici / socks；Workers 入口不会 import 它，故保持 shared/* 平台无关。
//
// 关键（见踩坑记录 proxy-fetch-dispatcher-binding）：必须用 undici 自己的 fetch 配
// undici 自己的 dispatcher——全局 fetch 不认外部 undici 包的 dispatcher。
//
// - http / https 代理：undici 自带 ProxyAgent（HTTP CONNECT 隧道），零额外逻辑。
// - socks5 代理：undici 不支持 SOCKS，用 socks 包先拨通隧道拿到 socket，
//   再把该 socket 交回 undici 的连接器做 TLS 升级（https 目标）。
import { Agent, ProxyAgent, buildConnector, fetch as undiciFetch, type Dispatcher } from 'undici';
import { SocksClient } from 'socks';
import type { ProxyConfig, FetchLike, MakeFetch } from '../shared/types.js';

// 构造 http/https 代理的 dispatcher。URI 的 scheme 表示「如何连到代理本身」：
// http → 明文连代理，https → TLS 连代理。认证信息编码进 URI。
function httpProxyDispatcher(cfg: ProxyConfig): Dispatcher {
  const scheme = cfg.type === 'https' ? 'https' : 'http';
  const auth = cfg.username
    ? `${encodeURIComponent(cfg.username)}:${encodeURIComponent(cfg.password ?? '')}@`
    : '';
  const uri = `${scheme}://${auth}${cfg.host}:${cfg.port}`;
  return new ProxyAgent(uri);
}

// 构造 socks5 代理的 dispatcher。自定义 undici Agent 的 connect：
// 先经 SOCKS 拨到目标，再对 https 目标用内建连接器完成 TLS。
function socksProxyDispatcher(cfg: ProxyConfig): Dispatcher {
  const connector = buildConnector({ timeout: 10_000 });

  return new Agent({
    connect(opts, callback) {
      const port = Number(opts.port) || (opts.protocol === 'https:' ? 443 : 80);
      SocksClient.createConnection({
        proxy: {
          host: cfg.host,
          port: cfg.port,
          type: 5,
          userId: cfg.username ?? undefined,
          password: cfg.password ?? undefined,
        },
        command: 'connect',
        destination: { host: opts.hostname, port },
      })
        .then(({ socket }) => {
          // https 目标：把已建立的 SOCKS socket 交给 undici 连接器做 TLS 握手
          if (opts.protocol === 'https:') {
            connector({ ...opts, httpSocket: socket }, callback);
            return;
          }
          // http 目标：直接使用该 socket
          callback(null, socket.setNoDelay());
        })
        .catch((err: unknown) => {
          callback(err instanceof Error ? err : new Error(String(err)), null);
        });
    },
  });
}

// 按类型构造 dispatcher。未知类型退回 http 处理（保守，不抛错中断爬取）。
function createDispatcher(cfg: ProxyConfig): Dispatcher {
  if (cfg.type === 'socks5') return socksProxyDispatcher(cfg);
  return httpProxyDispatcher(cfg);
}

// MakeFetch 实现：按代理配置返回一个绑定了该代理 dispatcher 的 undici.fetch。
// 用 undici 自己的 fetch（而非全局 fetch），确保与 dispatcher 同源、互认。
export const createProxyFetch: MakeFetch = (cfg: ProxyConfig): FetchLike => {
  const dispatcher = createDispatcher(cfg);
  return ((url: string, init?: unknown) =>
    undiciFetch(url, { ...(init as object), dispatcher }) as unknown as Promise<Response>) as FetchLike;
};
