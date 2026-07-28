<script setup lang="ts">
// 应用侧边栏：基于官方 shadcn-vue sidebar（常驻 + 图标折叠）重建。
// 保留 Phase C 的门控逻辑：admin 专属项 + 平台专属项、主题三档、账户 + 演示角色切换。
import { computed } from 'vue';
import {
  LayoutDashboard, CloudCog, Container, Activity, Server,
  Users, Settings, Info, Sun, LogOut, ShieldCheck,
} from 'lucide-vue-next';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarRail, SidebarSeparator, useSidebar,
} from '@/components/ui/sidebar';
import { ui, showView, type ViewName } from '@/stores/ui';
import { users, clearSession } from '@/stores/users';
import { useTheme, type ThemeMode } from '@/composables/useTheme';
import { api } from '@/api';
import { toast } from '@/composables/useToast';

const { theme, setTheme } = useTheme();
const { isMobile, setOpenMobile } = useSidebar();

const isAdmin = computed(() => users.currentRole === 'admin');

// 导航项定义：platform=仅该平台显示；role=仅该角色显示
interface NavItem {
  view: ViewName;
  label: string;
  icon: unknown;
  platform?: 'node' | 'workers';
  role?: 'admin';
}
const navItems: NavItem[] = [
  { view: 'dashboard', label: '站点', icon: LayoutDashboard },
  { view: 'scraperCf', label: '爬虫 · Cloudflare', icon: CloudCog, platform: 'workers' },
  { view: 'scraperDocker', label: '爬虫 · Docker', icon: Container, platform: 'node' },
  { view: 'activity', label: '测活', icon: Activity },
  { view: 'proxy', label: '代理 · Docker', icon: Server, platform: 'node' },
  { view: 'users', label: '用户管理', icon: Users, role: 'admin' },
  { view: 'settings', label: '设置', icon: Settings },
  { view: 'about', label: '关于', icon: Info },
];

const visibleNav = computed(() =>
  navItems.filter((it) => {
    if (it.role === 'admin' && !isAdmin.value) return false;
    if (it.platform && it.platform !== ui.deployPlatform) return false;
    return true;
  }),
);

const themeSegs: { key: ThemeMode; label: string }[] = [
  { key: 'light', label: '亮色' },
  { key: 'dark', label: '暗色' },
  { key: 'system', label: '跟随' },
];

const avatarChar = computed(() => (users.currentUsername[0] || 'U').toUpperCase());
const roleBadgeText = computed(() => (isAdmin.value ? '管理员' : '用户'));
const roleBadgeClass = computed(() =>
  isAdmin.value
    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
    : 'bg-muted text-muted-foreground',
);

// 导航：切视图 + 移动端关抽屉
function go(v: ViewName) {
  showView(v);
  if (isMobile.value) setOpenMobile(false);
}

async function logout() {
  try {
    await api.post('/api/logout');
  } catch {
    // 退出接口失败也照常清理本地会话（cookie 可能已失效）
  }
  clearSession();
  showView('login');
  if (isMobile.value) setOpenMobile(false);
}
</script>

<template>
  <Sidebar collapsible="icon">
    <SidebarHeader>
      <div class="flex items-center gap-2 px-2 py-1.5">
        <ShieldCheck :size="20" class="shrink-0" />
        <span class="text-base font-semibold group-data-[collapsible=icon]:hidden">Rrelaynest</span>
      </div>
    </SidebarHeader>

    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>导航</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem v-for="it in visibleNav" :key="it.view">
              <SidebarMenuButton
                :is-active="ui.view === it.view"
                :tooltip="it.label"
                @click="go(it.view)"
              >
                <component :is="it.icon" :size="16" />
                <span>{{ it.label }}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      <SidebarSeparator />

      <!-- 主题切换（折叠时隐藏，仅展开态可见） -->
      <SidebarGroup class="group-data-[collapsible=icon]:hidden">
        <SidebarGroupLabel>主题</SidebarGroupLabel>
        <SidebarGroupContent>
          <div class="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
            <Sun :size="16" />
            <div class="ml-auto inline-flex overflow-hidden rounded-md border border-border text-xs">
              <button
                v-for="(seg, i) in themeSegs"
                :key="seg.key"
                class="px-2 py-1"
                :class="[
                  i > 0 ? 'border-l border-border' : '',
                  theme === seg.key
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground',
                ]"
                @click="setTheme(seg.key)"
              >
                {{ seg.label }}
              </button>
            </div>
          </div>
        </SidebarGroupContent>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter>
      <!-- 账户 -->
      <div class="flex items-center gap-3 rounded-md px-2 py-1.5 group-data-[collapsible=icon]:px-0">
        <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
          {{ avatarChar }}
        </div>
        <div class="min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
          <p class="flex items-center gap-2 text-sm font-medium">
            <span class="truncate">{{ users.currentUsername }}</span>
            <span
              class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
              :class="roleBadgeClass"
            >{{ roleBadgeText }}</span>
          </p>
          <p class="truncate text-xs text-muted-foreground">{{ isAdmin ? '管理员账户' : '普通用户账户' }}</p>
        </div>
      </div>

      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton tooltip="退出" @click="logout">
            <LogOut :size="16" />
            <span>退出</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>

    <SidebarRail />
  </Sidebar>
</template>
