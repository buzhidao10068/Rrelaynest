<script setup lang="ts">
// 顶层 view-router（Phase C + sidebar 改造）：按 ui.view 切换整屏视图。
// 登录页独立无侧边栏；其余视图用官方 shadcn-vue sidebar（常驻 + 图标折叠）+ SidebarInset 包主内容。
import { ui } from '@/stores/ui';
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

// 初始化：主题（含 matchMedia 监听）。角色/ack 由 users store 初始化时从 localStorage 读。
useTheme();
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
