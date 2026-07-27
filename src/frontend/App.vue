<script setup lang="ts">
// 顶层 view-router（Phase C + sidebar 改造）：按 ui.view 切换整屏视图。
// 登录页独立无侧边栏；其余视图用官方 shadcn-vue sidebar（常驻 + 图标折叠）+ SidebarInset 包主内容。
import { computed } from 'vue';
import { ui } from '@/stores/ui';
import { useTheme } from '@/composables/useTheme';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import AppSidebar from '@/components/AppSidebar.vue';
import AppHeader from '@/components/AppHeader.vue';
import ToastHost from '@/components/ToastHost.vue';
import LoginView from '@/views/LoginView.vue';
import DashboardView from '@/views/DashboardView.vue';
import ProxyView from '@/views/ProxyView.vue';

// 初始化：主题（含 matchMedia 监听）。角色/ack 由 users store 初始化时从 localStorage 读。
useTheme();

// 未迁移视图的占位标题（Phase D~K 逐步替换）
const placeholderTitles: Record<string, string> = {
  scraperCf: '爬虫 · Cloudflare',
  scraperDocker: '爬虫 · Docker',
  activity: '测活',
  users: '用户管理',
  userSites: '用户站点',
  settings: '设置',
  about: '关于',
};
const placeholderTitle = computed(() => placeholderTitles[ui.view] ?? ui.view);
</script>

<template>
  <LoginView v-if="ui.view === 'login'" />

  <SidebarProvider v-else :default-open="true">
    <AppSidebar />
    <SidebarInset>
      <DashboardView v-if="ui.view === 'dashboard'" />
      <ProxyView v-else-if="ui.view === 'proxy'" />

      <!-- 未迁移视图占位（Phase D~K 逐步替换） -->
      <template v-else>
        <AppHeader :title="placeholderTitle" />
        <div class="p-10 text-center text-sm text-muted-foreground">
          「{{ placeholderTitle }}」视图将在后续 Phase 迁移
        </div>
      </template>
    </SidebarInset>
  </SidebarProvider>

  <ToastHost />
</template>
