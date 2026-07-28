// 多用户状态：当前角色（后端权威）、mock 用户表、跨用户站点、条款解锁标记。
// 角色/用户名来自 /api/session（登录引导时注入 setSession），前端不可切——
// 演示端的角色切换已删。用户表/跨用户站点仍 mock，留待各自轮次接线。
import { reactive } from 'vue';
import { ui, showView } from '@/stores/ui';
import { settingsState } from '@/stores/settings';

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

const ACK_KEY = 'rrelaynest-global-view-ack';

export const users = reactive<UsersState>({
  currentRole: 'user', // 占位，登录引导 setSession 后以后端为准
  currentUsername: '',
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

// 登录引导：把 /api/session 的角色/用户名注入 store（后端权威，前端不可切）。
// 若非 admin 却停在 admin 专属页，弹回主页（前端兜底，真正拦截在后端 403）。
export function setSession(username: string, role: Role): void {
  users.currentUsername = username;
  users.currentRole = role;
  if (role !== 'admin' && (ui.view === 'users' || ui.view === 'userSites')) {
    showView('dashboard');
  }
}

// 退出/会话失效：清空当前用户上下文。
export function clearSession(): void {
  users.currentUsername = '';
  users.currentRole = 'user';
  users.viewingUserId = null;
}

export function setGlobalViewAck(v: boolean): void {
  users.globalViewAck = v;
  localStorage.setItem(ACK_KEY, String(v));
}

// 演示：id=1 视为当前登录的 admin 自己（自我保护判定基准）
export const SELF_USER_ID = 1;
export function isSelf(id: number): boolean {
  return id === SELF_USER_ID;
}

export function findUser(id: number): MockUser | undefined {
  return users.users.find((u) => u.id === id);
}

// 停用/启用用户（不能停用自己）。返回新的 disabled 态，失败返回 null。
export function toggleUserDisabled(id: number): 0 | 1 | null {
  if (isSelf(id)) return null;
  const u = findUser(id);
  if (!u) return null;
  u.disabled = u.disabled ? 0 : 1;
  return u.disabled;
}

// 删除用户（不能删自己）+ 级联删其站点。成功返回 true。
export function deleteUser(id: number): boolean {
  if (isSelf(id)) return false;
  const idx = users.users.findIndex((u) => u.id === id);
  if (idx < 0) return false;
  users.users.splice(idx, 1);
  delete users.userSites[id];
  return true;
}

// 新增/编辑用户结果：ok=false 时 error 为原因文案。
export interface SaveUserResult { ok: boolean; error?: string; created?: boolean; }

// 新建（editingId=null）或编辑（editingId=用户 id）。
// 编辑：仅改角色（用户名不可改）；防锁死——不能把自己降级。pw 非空表示重置密码（mock 不落）。
// 新建：用户名/初始密码必填 + 用户名唯一。
export function saveUser(
  editingId: number | null,
  name: string,
  pw: string,
  role: Role,
): SaveUserResult {
  const trimmed = name.trim();
  if (editingId != null) {
    const u = findUser(editingId);
    if (!u) return { ok: false, error: '用户不存在' };
    if (isSelf(u.id) && role !== 'admin') return { ok: false, error: '不能降级自己（防锁死）' };
    u.role = role;
    return { ok: true };
  }
  if (!trimmed) return { ok: false, error: '用户名必填' };
  if (users.users.some((x) => x.username === trimmed)) return { ok: false, error: '用户名已存在' };
  if (!pw) return { ok: false, error: '初始密码必填' };
  const newId = Math.max(0, ...users.users.map((x) => x.id)) + 1;
  users.users.push({
    id: newId, username: trimmed, role, disabled: 0, sites: 0, created_at: '2026-07-27',
  });
  users.userSites[newId] = [];
  return { ok: true, created: true };
}

// ---- 导航（双门控：admin + ack） ----

// 进入用户管理页（admin-only；非 admin 拦下返回 false）
export function showAdminUsers(): boolean {
  if (users.currentRole !== 'admin') return false;
  showView('users');
  return true;
}

// 跨用户只读站点：需 admin + 已解锁 ack（双门控）。失败返回原因，成功返回 null。
export function showUserSites(uid: number): string | null {
  if (users.currentRole !== 'admin') return '普通用户无权访问';
  if (!users.globalViewAck) return '请先到 设置 → 协作与隐私 解锁条款';
  users.viewingUserId = uid;
  showView('userSites');
  return null;
}

// 从用户管理页跳到「协作与隐私」设置分区
export function goPrivacySettings(): void {
  settingsState.pendingSection = 'privacy';
  showView('settings');
}
