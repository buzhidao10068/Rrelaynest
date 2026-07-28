<script setup lang="ts">
// 顶层 view-router（Phase C + sidebar 改造）：按 ui.view 切换整屏视图。
// 登录页独立无侧边栏；其余视图用官方 shadcn-vue sidebar（常驻 + 图标折叠）+ SidebarInset 包主内容。
import { onMounted } from 'vue';
import { ui, showView } from '@/stores/ui';
import { setSession, clearSession } from '@/stores/users';
import { api, setUnauthorizedHandler } from '@/api';
import { useTheme } from '@/composables/useTheme';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import AppSidebar from '@/components/AppSidebar.vue';
import ToastHost from '@/components/ToastHost.vue';
import LoginView from '@/views/LoginView.vue';
import DashboardView from '@/views/DashboardView.vue';
import ProxyView from '@/views/ProxyView.vue';
import ActivityView from '@/views/ActivityView.vue';
import ScraperCfView from '@/views/ScraperCfView.vue';
import ScraperDockerView from '@/views/ScraperDockerView.vue';
import SettingsView from '@/views/SettingsView.vue';
import UsersView from '@/views/UsersView.vue';
import UserSitesView from '@/views/UserSitesView.vue';
import AboutView from '@/views/AboutView.vue';

// 初始化：主题（含 matchMedia 监听）。
useTheme();

// 全局 401 处理：任一请求遇会话失效 → 清空会话上下文 + 切回登录页。
setUnauthorizedHandler(() => {
  clearSession();
  showView('login');
});

// 启动引导：回查 /api/session。已登录则注入角色/用户名并进主页；否则停在登录页。
onMounted(async () => {
  try {
    const s = await api.get<{ authenticated: boolean; username?: string; role?: string }>(
      '/api/session',
    );
    if (s.authenticated) {
      setSession(s.username ?? '', s.role === 'admin' ? 'admin' : 'user');
      if (ui.view === 'login') showView('dashboard');
    }
  } catch {
    // 引导查询失败（如网络）不阻塞渲染，留在登录页即可。
  }
});
</script>

<template>
  <LoginView v-if="ui.view === 'login'" />

  <SidebarProvider v-else :default-open="true">
    <AppSidebar />
    <SidebarInset>
      <DashboardView v-if="ui.view === 'dashboard'" />
      <ProxyView v-else-if="ui.view === 'proxy'" />
      <ActivityView v-else-if="ui.view === 'activity'" />
      <ScraperCfView v-else-if="ui.view === 'scraperCf'" />
      <ScraperDockerView v-else-if="ui.view === 'scraperDocker'" />
      <SettingsView v-else-if="ui.view === 'settings'" />
      <UsersView v-else-if="ui.view === 'users'" />
      <UserSitesView v-else-if="ui.view === 'userSites'" />
      <AboutView v-else-if="ui.view === 'about'" />
    </SidebarInset>
  </SidebarProvider>

  <ToastHost />
</template>
