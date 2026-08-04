<script setup lang="ts">
// 通用偏好分区：默认货币显示、隐藏分页开关、部署平台展示 + 平台功能过滤。
// 部署平台是后端权威事实（经 /api/session 下发），前端只读、不可改；「自动检测」= 重新问后端。
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { RefreshCw } from 'lucide-vue-next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { settingsState, persistCurrency } from '@/stores/settings';
import { sitesState, setPaginationHidden } from '@/stores/sites';
import { ui, refreshPlatform, type DeployPlatform } from '@/stores/ui';
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

// 平台全称：null = 后端尚未告知（首屏 /api/session 返回前，或检测失败）
function platformLabel(p: DeployPlatform | null): string {
  if (p === 'workers') return 'Cloudflare Workers';
  if (p === 'node') return 'Docker / Node';
  return '';
}
const platformResult = computed(() =>
  ui.deployPlatform === null
    ? t('settings.general.detectingPlatform')
    : t('settings.general.currentPlatform', { platform: platformLabel(ui.deployPlatform) }),
);

// 自动检测：真的重新问一次后端（GET /api/session），如实反映返回值。
const detecting = ref(false);
async function detectPlatform() {
  if (detecting.value) return;
  detecting.value = true;
  try {
    const p = await refreshPlatform();
    if (p) toast(t('settings.general.detectedPlatformToast', { platform: platformLabel(p) }), 'success');
    else toast(t('settings.general.detectFailedToast'), 'error');
  } finally {
    detecting.value = false;
  }
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
        <Button
          variant="outline"
          size="sm"
          class="shrink-0 gap-1.5"
          :disabled="detecting"
          @click="detectPlatform"
        >
          <RefreshCw :size="15" :class="detecting && 'animate-spin'" />
          {{ t('settings.general.autoDetect') }}
        </Button>
      </div>
      <p class="text-xs text-muted-foreground">
        {{ t('settings.general.platformFilterHint') }}
      </p>
    </div>
  </div>
</template>
