// 多用户状态：当前角色、mock 用户表、跨用户站点、条款解锁标记。
// 全部前端 mock（块 7 本轮不接后端）。角色/ack 持久化到 localStorage，
// 对齐 docs/ui-preview.html 的演示行为。真实端角色来自 /api/me，前端不可切。
import { reactive } from 'vue';

export type Role = 'admin' | 'user';

export interface MockUser {
  id: number;
  username: string;
  role: Role;
  disabled: 0 | 1;
  sites: number;
  created_at: string;
}

// 跨用户只读站点（已剔除 token；块 7 换成 /api/admin/users/:uid/sites）
export interface UserSite {
  name: string;
  base_url: string;
  currency: string;
  balance: number;
  checkin_enabled: 0 | 1;
  checkin_done: 0 | 1;
}

interface UsersState {
  currentRole: Role;
  currentUsername: string;
  // 跨用户只读解锁标记：对应后端 settings 的 admin_global_view_ack
  globalViewAck: boolean;
  users: MockUser[];
  userSites: Record<number, UserSite[]>;
  viewingUserId: number | null;
}

const ROLE_KEY = 'rrelaynest-demo-role';
const ACK_KEY = 'rrelaynest-global-view-ack';

function loadRole(): Role {
  return localStorage.getItem(ROLE_KEY) === 'user' ? 'user' : 'admin';
}

export const users = reactive<UsersState>({
  currentRole: loadRole(),
  currentUsername: 'admin',
  globalViewAck: localStorage.getItem(ACK_KEY) === 'true',
  users: [
    { id: 1, username: 'admin', role: 'admin', disabled: 0, sites: 6, created_at: '2026-06-01' },
    { id: 2, username: 'alice', role: 'user', disabled: 0, sites: 3, created_at: '2026-07-10' },
    { id: 3, username: 'bob', role: 'user', disabled: 1, sites: 0, created_at: '2026-07-18' },
  ],
  userSites: {
    2: [
      { name: 'Alice 中转A', base_url: 'https://a1.example.com', currency: 'USD', balance: 42.5, checkin_enabled: 1, checkin_done: 1 },
      { name: 'Alice 中转B', base_url: 'https://a2.example.com', currency: 'CNY', balance: 108, checkin_enabled: 0, checkin_done: 0 },
      { name: 'Alice 备用', base_url: 'https://a3.example.com', currency: 'USD', balance: 0, checkin_enabled: 1, checkin_done: 0 },
    ],
    3: [],
  },
  viewingUserId: null,
});

export function isAdmin(): boolean {
  return users.currentRole === 'admin';
}

// 演示端角色切换（块 7 删除；真实端角色由后端决定）
export function setDemoRole(r: Role): void {
  users.currentRole = r;
  localStorage.setItem(ROLE_KEY, r);
}

export function setGlobalViewAck(v: boolean): void {
  users.globalViewAck = v;
  localStorage.setItem(ACK_KEY, String(v));
}
