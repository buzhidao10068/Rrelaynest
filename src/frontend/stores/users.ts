// 多用户状态（Phase J → 块8 接后端 /api/admin/users*）：当前会话（后端权威）+ 用户表 + 跨用户只读站点 + 条款解锁。
// 角色/用户名/id 来自 /api/session（登录引导时注入 setSession），前端不可切。
// 用户表/跨用户站点/ack 全部接真后端；自我保护基准 currentUserId 来自会话（不再硬编码 id=1）。
import { reactive } from 'vue';
import { ui, showView } from '@/stores/ui';
import { settingsState } from '@/stores/settings';
import { resetDisclaimerState } from '@/stores/disclaimer';
import { api } from '@/api';
import { t } from '@/i18n';

export type Role = 'admin' | 'user';

// 后端 /api/admin/users 行（不含 password_hash；created_at/updated_at 为毫秒时间戳；sites=站点数）。
export interface AdminUser {
  id: number;
  username: string;
  role: Role;
  disabled: 0 | 1;
  session_version: number;
  created_at: number;
  updated_at: number;
  sites: number;
}

// 跨用户只读站点（后端已剔除 token，附 has_token）。取展示所需的最小字段。
export interface UserSite {
  id: number;
  name: string;
  base_url: string;
  currency: string;
  balance: number | null;
  checkin_enabled: 0 | 1;
  checkin_done: 0 | 1;
}

interface UsersState {
  currentUserId: number | null; // 当前登录用户 id（自我保护基准）
  currentRole: Role;
  currentUsername: string;
  // 跨用户只读解锁标记：对应后端 settings 的 admin_global_view_ack
  globalViewAck: boolean;
  users: AdminUser[];
  userSites: Record<number, UserSite[]>;
  viewingUserId: number | null;
}

export const users = reactive<UsersState>({
  currentUserId: null,
  currentRole: 'user', // 占位，登录引导 setSession 后以后端为准
  currentUsername: '',
  globalViewAck: false,
  users: [],
  userSites: {},
  viewingUserId: null,
});

export function isAdmin(): boolean {
  return users.currentRole === 'admin';
}

// 登录引导：把 /api/session 的 id/角色/用户名注入 store（后端权威，前端不可切）。
// 若非 admin 却停在 admin 专属页，弹回主页（前端兜底，真正拦截在后端 403）。
export function setSession(id: number | null, username: string, role: Role): void {
  users.currentUserId = id;
  users.currentUsername = username;
  users.currentRole = role;
  if (role !== 'admin' && (ui.view === 'users' || ui.view === 'userSites')) {
    showView('dashboard');
  }
}

// 退出/会话失效：清空当前用户上下文与缓存。
export function clearSession(): void {
  users.currentUserId = null;
  users.currentUsername = '';
  users.currentRole = 'user';
  users.viewingUserId = null;
  users.users = [];
  users.userSites = {};
  resetDisclaimerState(); // 换账号不串号：清免责同意内存态，下次登录按新账号重读
}

// 自我保护：目标 id 是否是当前登录的自己。
export function isSelf(id: number): boolean {
  return users.currentUserId != null && id === users.currentUserId;
}

export function findUser(id: number): AdminUser | undefined {
  return users.users.find((u) => u.id === id);
}

// ---- 用户表（GET /api/admin/users）+ ack（GET /api/settings）----
export async function loadUsers(): Promise<void> {
  const [{ users: list }, { settings }] = await Promise.all([
    api.get<{ users: AdminUser[] }>('/api/admin/users'),
    api.get<{ settings: Record<string, string> }>('/api/settings'),
  ]);
  users.users = list;
  users.globalViewAck = !!settings.admin_global_view_ack;
}

// 停用/启用用户（不能停用自己）。成功后 reload 用户表。返回新的 disabled 态，失败/不可用返回 null。
export async function toggleUserDisabled(id: number): Promise<0 | 1 | null> {
  if (isSelf(id)) return null;
  const u = findUser(id);
  if (!u) return null;
  const next: 0 | 1 = u.disabled ? 0 : 1;
  await api.put(`/api/admin/users/${id}`, { disabled: !!next });
  await loadUsers();
  return next;
}

// 删除用户（不能删自己）+ 后端级联删其站点/代理/设置。成功返回 true。
export async function deleteUser(id: number): Promise<boolean> {
  if (isSelf(id)) return false;
  if (!findUser(id)) return false;
  await api.del(`/api/admin/users/${id}`);
  await loadUsers();
  return true;
}

// 新建（editingId=null）或编辑（editingId=用户 id）。
// 编辑：改角色 + 可选重置密码（pw 非空）；防锁死（不能降级自己）由后端 400 兜底。
// 新建：用户名/初始密码必填 + 用户名唯一（后端 409 兜底）。成功后 reload 用户表。
export async function saveUser(
  editingId: number | null,
  name: string,
  pw: string,
  role: Role,
): Promise<void> {
  if (editingId != null) {
    const body: { role: Role; password?: string } = { role };
    if (pw) body.password = pw;
    await api.put(`/api/admin/users/${editingId}`, body);
  } else {
    await api.post('/api/admin/users', { username: name.trim(), password: pw, role });
  }
  await loadUsers();
}

// ---- 跨用户只读站点（GET /api/admin/users/:uid/sites，双门控由后端 requireAdmin+ack 把关）----
export async function loadUserSites(uid: number): Promise<void> {
  const { sites } = await api.get<{ sites: UserSite[] }>(`/api/admin/users/${uid}/sites`);
  users.userSites[uid] = sites;
}

// ---- 条款解锁（写 /api/settings 的 admin_global_view_ack）----
export async function setGlobalViewAck(v: boolean): Promise<void> {
  // 撤销写空串（后端 requireGlobalViewAck 判「非空即放行」）。
  await api.put('/api/settings', { admin_global_view_ack: v ? '1' : '' });
  users.globalViewAck = v;
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
  if (users.currentRole !== 'admin') return t('users.noPermission');
  if (!users.globalViewAck) return t('users.needUnlock');
  users.viewingUserId = uid;
  showView('userSites');
  return null;
}

// 从用户管理页跳到「协作与隐私」设置分区
export function goPrivacySettings(): void {
  settingsState.pendingSection = 'privacy';
  showView('settings');
}
