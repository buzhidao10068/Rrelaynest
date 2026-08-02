<script setup lang="ts">
// 设置页（Phase I）：左分区导航 + 右内容。分区：通用偏好 / 安全 / 签到 / 记录 / 数据 / 协作与隐私。
// 「协作与隐私」仅 admin 可见（跨用户只读的条款解锁）；非 admin 落到该分区回退通用偏好。
import { ref, computed, watch, onMounted, type Component } from 'vue';
import {
  Settings2, ShieldCheck, CalendarCheck, History, Database, Eye,
} from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import AppHeader from '@/components/AppHeader.vue';
import { users } from '@/stores/users';
import { settingsState, loadSettings } from '@/stores/settings';
import GeneralSection from '@/components/settings/GeneralSection.vue';
import SecuritySection from '@/components/settings/SecuritySection.vue';
import CheckinSection from '@/components/settings/CheckinSection.vue';
import RecordsSection from '@/components/settings/RecordsSection.vue';
import DataSection from '@/components/settings/DataSection.vue';
import PrivacySection from '@/components/settings/PrivacySection.vue';

type SectionKey = 'general' | 'security' | 'checkin' | 'records' | 'data' | 'privacy';

interface NavItem {
  key: SectionKey;
  labelKey: string;
  icon: Component;
  comp: Component;
  adminOnly?: boolean;
}

const { t } = useI18n({ useScope: 'global' });

const navItems: NavItem[] = [
  { key: 'general', labelKey: 'settings.nav.general', icon: Settings2, comp: GeneralSection },
  { key: 'security', labelKey: 'settings.nav.security', icon: ShieldCheck, comp: SecuritySection },
  { key: 'checkin', labelKey: 'settings.nav.checkin', icon: CalendarCheck, comp: CheckinSection },
  { key: 'records', labelKey: 'settings.nav.records', icon: History, comp: RecordsSection },
  { key: 'data', labelKey: 'settings.nav.data', icon: Database, comp: DataSection },
  { key: 'privacy', labelKey: 'settings.nav.privacy', icon: Eye, comp: PrivacySection, adminOnly: true },
];

const isAdmin = computed(() => users.currentRole === 'admin');
const visibleNav = computed(() => navItems.filter((it) => !it.adminOnly || isAdmin.value));

const active = ref<SectionKey>('general');

// 外部（用户管理页「前往设置」）请求跳转分区：消费 settingsState.pendingSection。
function consumePending() {
  const p = settingsState.pendingSection as SectionKey | null;
  if (p && visibleNav.value.some((it) => it.key === p)) {
    active.value = p;
  }
  settingsState.pendingSection = null;
}
onMounted(() => {
  consumePending();
  // 从后端加载杂项设置（checkinDefaultOn / timezone）；失败静默（api 层已 toast）。
  void loadSettings().catch(() => { /* noop */ });
});
watch(() => settingsState.pendingSection, (p) => { if (p) consumePending(); });

// 角色切到非 admin 且正停在 privacy 分区 → 回退通用偏好（模拟后端 403 兜底）
watch(isAdmin, (admin) => {
  if (!admin && active.value === 'privacy') active.value = 'general';
});

const activeComp = computed<Component>(
  () => (visibleNav.value.find((it) => it.key === active.value) ?? navItems[0]).comp,
);
</script>

<template>
  <div class="min-h-screen bg-background">
    <AppHeader :title="t('settings.title')" />

    <div class="mx-auto flex max-w-[1100px] flex-col gap-6 p-4 sm:p-6 md:flex-row">
      <!-- 左分区导航：窄屏横向滚动，宽屏固定左列 -->
      <nav class="flex shrink-0 gap-1 overflow-x-auto md:w-52 md:flex-col md:space-y-1 md:overflow-visible">
        <button
          v-for="it in visibleNav"
          :key="it.key"
          class="flex shrink-0 items-center gap-3 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm transition-colors md:w-full"
          :class="active === it.key
            ? 'bg-accent font-medium text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50'"
          @click="active = it.key"
        >
          <component :is="it.icon" :size="16" class="shrink-0" />
          {{ t(it.labelKey) }}
        </button>
      </nav>

      <!-- 右内容 -->
      <div class="min-w-0 flex-1">
        <component :is="activeComp" />
      </div>
    </div>
  </div>
</template>
