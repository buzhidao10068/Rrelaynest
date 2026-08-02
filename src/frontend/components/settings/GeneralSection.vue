<script setup lang="ts">
// 通用偏好分区：默认货币显示、隐藏分页开关、部署平台检测 + 平台功能过滤。
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { RefreshCw, RotateCw } from 'lucide-vue-next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { settingsState, persistCurrency } from '@/stores/settings';
import { sitesState, setPaginationHidden } from '@/stores/sites';
import { ui, setDeployPlatform, type DeployPlatform } from '@/stores/ui';
import { toast } from '@/composables/useToast';

const { t } = useI18n({ useScope: 'global' });

// 隐藏分页：唯一事实来源在 sites store
const hidePagination = computed({
  get: () => sitesState.paginationHidden,
  set: (v: boolean) => {
    setPaginationHidden(v);
    toast(v ? t('settings.general.paginationHiddenToast') : t('settings.general.paginationRestoredToast'), 'info');
  },
});

function platformLabel(p: DeployPlatform): string {
  return p === 'workers' ? 'Cloudflare' : 'Docker';
}
const platformResult = computed(
  () => t('settings.general.currentPlatform', {
    platform: `${platformLabel(ui.deployPlatform)}${ui.deployPlatform === 'workers' ? ' Workers' : ' / Node'}`,
  }),
);

// 自动检测（mock：600ms 转圈后确认当前平台）
function detectPlatform() {
  setDeployPlatform(ui.deployPlatform); // 持久化当前值
  toast(t('settings.general.detectedPlatformToast', { platform: platformLabel(ui.deployPlatform) }), 'success');
}

// 演示端可在两平台间切换（真实端由后端注入，前端不可改）
function switchPlatform(p: DeployPlatform) {
  if (p === ui.deployPlatform) return;
  setDeployPlatform(p);
  toast(t('settings.general.switchedDemoPlatformToast', { platform: platformLabel(p) }), 'info');
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-base font-semibold">{{ t('settings.general.title') }}</h3>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.general.desc') }}</p>
    </div>

    <div class="space-y-1.5">
      <Label>{{ t('settings.general.defaultCurrency') }}</Label>
      <Input v-model="settingsState.currency" class="w-64" @blur="persistCurrency" />
    </div>

    <!-- 隐藏分页 -->
    <div class="flex items-center gap-4 rounded-lg border border-border p-4">
      <Switch v-model="hidePagination" />
      <div>
        <p class="text-sm font-medium">{{ t('settings.general.hidePagination') }}</p>
        <p class="text-xs text-muted-foreground">{{ t('settings.general.hidePaginationDesc') }}</p>
      </div>
    </div>

    <!-- 部署平台检测 + 过滤 -->
    <div class="space-y-3 rounded-lg border border-border p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-sm font-medium">{{ t('settings.general.deployPlatform') }}</p>
          <p class="mt-0.5 text-xs text-muted-foreground">{{ platformResult }}</p>
        </div>
        <Button variant="outline" size="sm" class="shrink-0 gap-1.5" @click="detectPlatform">
          <RefreshCw :size="15" />
          {{ t('settings.general.autoDetect') }}
        </Button>
      </div>
      <!-- 演示端平台切换（真实端由后端决定，此处便于预览两平台专属功能） -->
      <div class="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        <RotateCw :size="14" class="shrink-0" />
        <span class="shrink-0">{{ t('settings.general.demoPlatform') }}</span>
        <div class="ml-auto inline-flex overflow-hidden rounded-md border border-border">
          <button
            class="px-3 py-1"
            :class="ui.deployPlatform === 'node' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'"
            @click="switchPlatform('node')"
          >Docker / Node</button>
          <button
            class="border-l border-border px-3 py-1"
            :class="ui.deployPlatform === 'workers' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'"
            @click="switchPlatform('workers')"
          >Cloudflare</button>
        </div>
      </div>
      <p class="text-xs text-muted-foreground">
        {{ t('settings.general.platformFilterHint') }}
      </p>
    </div>
  </div>
</template>
