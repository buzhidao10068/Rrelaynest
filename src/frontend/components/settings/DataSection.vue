<script setup lang="ts">
// 数据分区（Phase I/K）：选择导出弹窗（Phase K 接入）+ 危险区清空全部数据。
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Download, Trash2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { clearAll, sitesState } from '@/stores/sites';
import { ApiError } from '@/api';
import { toast } from '@/composables/useToast';
import ExportModal from '@/components/site/ExportModal.vue';

const { t } = useI18n({ useScope: 'global' });

const exportOpen = ref(false);

function onExport() {
  if (!sitesState.list.length) {
    toast(t('settings.data.nothingToExport'), 'info');
    return;
  }
  exportOpen.value = true;
}

async function onClearAll() {
  if (!sitesState.list.length) {
    toast(t('settings.data.nothingToClear'), 'info');
    return;
  }
  if (!confirm(t('settings.data.clearConfirm'))) return;
  try {
    await clearAll();
    toast(t('settings.data.clearedToast'), 'success');
  } catch (e) {
    toast(e instanceof ApiError ? e.message : t('settings.data.clearFailed'), 'error');
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-base font-semibold">{{ t('settings.data.title') }}</h3>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.data.desc') }}</p>
    </div>

    <div class="flex flex-wrap gap-2">
      <Button variant="outline" @click="onExport">
        <Download :size="15" />
        {{ t('settings.data.selectExport') }}
      </Button>
    </div>
    <p class="text-xs text-muted-foreground">{{ t('settings.data.exportNote') }}</p>

    <!-- 危险区 -->
    <div class="rounded-lg border border-red-500/40 p-4">
      <p class="text-sm font-medium text-red-500">{{ t('settings.data.dangerZone') }}</p>
      <p class="mt-1 text-xs text-muted-foreground">{{ t('settings.data.dangerDesc') }}</p>
      <Button
        class="mt-3 bg-red-500 text-white hover:bg-red-600"
        @click="onClearAll"
      >
        <Trash2 :size="15" />
        {{ t('settings.data.clearAll') }}
      </Button>
    </div>

    <ExportModal :open="exportOpen" @close="exportOpen = false" />
  </div>
</template>
