<script setup lang="ts">
// 顶层 view-router（Phase C + sidebar 改造）：按 ui.view 切换整屏视图。
// 登录页独立无侧边栏；其余视图用官方 shadcn-vue sidebar（常驻 + 图标折叠）+ SidebarInset 包主内容。
import { onMounted } from 'vue';
import { ui, showView, setDeployPlatform, setConfigWarnings } from '@/stores/ui';
import type { DeployPlatform } from '@/stores/ui';
import { setSession, clearSession } from '@/stores/users';
import { disclaimerState, loadDisclaimer } from '@/stores/disclaimer';
import { api, setUnauthorizedHandler } from '@/api';
import { useTheme } from '@/composables/useTheme';
import { SidebarProvider, SidebarInset } from '@/components/ui/sidebar';
import AppSidebar from '@/components/AppSidebar.vue';
import ToastHost from '@/components/ToastHost.vue';
import ConfigWarningBanner from '@/components/ConfigWarningBanner.vue';
import DisclaimerGate from '@/components/DisclaimerGate.vue';
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
// platform 与 configWarnings 都是部署期事实（后端权威），未登录也会下发，
// 故先于 authenticated 分支写入 —— 这样登录页就能显示配置提示条。
onMounted(async () => {
  try {
    const s = await api.get<{
      authenticated: boolean;
      id?: number;
      username?: string;
      role?: string;
      platform?: DeployPlatform;
      configWarnings?: string[];
    }>('/api/session');
    setDeployPlatform(s.platform ?? null);
    setConfigWarnings(s.configWarnings);
    if (s.authenticated) {
      setSession(s.id ?? null, s.username ?? '', s.role === 'admin' ? 'admin' : 'user');
      await loadDisclaimer(); // 认证后、进主面板前读免责同意态（未同意则渲染门禁）
      if (ui.view === 'login') showView('dashboard');
    }
  } catch {
    // 引导查询失败（如网络）不阻塞渲染，留在登录页即可。
  }
});
</script>

<template>
  <!-- 服务端配置健康提示条（无告警时组件自身不渲染，零占位）。落点分两处，都是被布局逼出来的：
       · 登录页：放这里，全宽正常显示。
       · 主面板：放 SidebarInset 内部（见下），因为侧栏是 `fixed inset-y-0 z-10` 从 y=0 起算，
         放在它外面会被压住左侧 256px —— 标题和图标正好在那儿，实测整条标题不可见。
       · 免责门禁：**故意不显示**。门禁是 `fixed inset-0 z-50` + `bg-background/95` + 毛玻璃的
         全屏遮罩，任何放在它下面的东西都被糊住看不清；提亮 z-index 又会盖住门禁本身（那是
         必须先读的法律文本）。用户点完「同意并继续」立刻就会在主面板看到提示条，只差一步。
       侧栏与门禁都是生成/既有组件，按规范不去改它们，故改提示条的落点。 -->
  <ConfigWarningBanner v-if="ui.view === 'login'" />

  <LoginView v-if="ui.view === 'login'" />

  <!-- 已登录：进主面板前须先过免责声明门禁（per-user，未同意则全屏拦截；加载中留白避免闪现） -->
  <template v-else>
    <DisclaimerGate v-if="disclaimerState.loaded && !disclaimerState.accepted" />

    <SidebarProvider v-else-if="disclaimerState.loaded" :default-open="true">
      <AppSidebar />
      <SidebarInset>
        <!-- 在内容列之内，故不受 fixed 侧栏遮挡 -->
        <ConfigWarningBanner />
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
  </template>

  <ToastHost />
</template>
