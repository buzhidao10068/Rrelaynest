// 代理池（Phase E 起：编辑弹窗的出站代理下拉需要它；完整代理页在 Phase F）。
// 每条 { name, type, host, port, user, pass, enabled }；globalProxy=选作全局的代理名（''=直连）。
import { reactive } from 'vue';

export type ProxyType = 'http' | 'https' | 'socks5';

export interface Proxy {
  name: string;
  type: ProxyType;
  host: string;
  port: number;
  user: string;
  pass: string;
  enabled: boolean;
}

interface ProxyState {
  list: Proxy[];
  globalProxy: string; // 全局代理名（''=直连）
}

export const proxyState = reactive<ProxyState>({
  list: [
    { name: '本地-Clash', type: 'http', host: '127.0.0.1', port: 7890, user: '', pass: '', enabled: true },
    { name: '机场-香港', type: 'socks5', host: 'hk.example.com', port: 1080, user: 'vpnuser', pass: 'secret', enabled: true },
    { name: '公司-出口', type: 'https', host: 'gw.corp.example', port: 8443, user: '', pass: '', enabled: false },
  ],
  globalProxy: '',
});

// 代理类型徽章配色：http=蓝 / https=绿 / socks5=紫
export const PROXY_TYPE_STYLE: Record<ProxyType, string> = {
  http: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  https: 'bg-green-500/15 text-green-600 dark:text-green-400',
  socks5: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
};

// 下拉基础标签：null=跟随全局/直连
export function proxyBaseLabel(p: Proxy | null): string {
  if (!p) return '跟随全局设置';
  return `${p.name}（${p.type}://${p.host}:${p.port}）`;
}
