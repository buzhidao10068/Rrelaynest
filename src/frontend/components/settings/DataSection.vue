<script setup lang="ts">
// 数据分区（Phase I/K）：选择导出弹窗（Phase K 接入）+ 危险区清空全部数据。
import { ref } from 'vue';
import { Download, Trash2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { clearAll, sitesState } from '@/stores/sites';
import { ApiError } from '@/api';
import { toast } from '@/composables/useToast';
import ExportModal from '@/components/site/ExportModal.vue';

const exportOpen = ref(false);

function onExport() {
  if (!sitesState.list.length) {
    toast('暂无站点可导出', 'info');
    return;
  }
  exportOpen.value = true;
}

async function onClearAll() {
  if (!sitesState.list.length) {
    toast('已经没有数据可清空', 'info');
    return;
  }
  if (!confirm('确认清空所有站点及爬取数据？此操作不可恢复！')) return;
  try {
    await clearAll();
    toast('已清空全部数据', 'success');
  } catch (e) {
    toast(e instanceof ApiError ? e.message : '清空失败', 'error');
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-base font-semibold">数据</h3>
      <p class="mt-1 text-sm text-muted-foreground">导出与清空本地数据。</p>
    </div>

    <div class="flex flex-wrap gap-2">
      <Button variant="outline" @click="onExport">
        <Download :size="15" />
        选择导出
      </Button>
    </div>
    <p class="text-xs text-muted-foreground">导出内容不含 token 明文。</p>

    <!-- 危险区 -->
    <div class="rounded-lg border border-red-500/40 p-4">
      <p class="text-sm font-medium text-red-500">危险区</p>
      <p class="mt-1 text-xs text-muted-foreground">清空所有站点及爬取数据，不可恢复。</p>
      <Button
        class="mt-3 bg-red-500 text-white hover:bg-red-600"
        @click="onClearAll"
      >
        <Trash2 :size="15" />
        清空全部数据
      </Button>
    </div>

    <ExportModal :open="exportOpen" @close="exportOpen = false" />
  </div>
</template>
