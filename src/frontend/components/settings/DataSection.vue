<script setup lang="ts">
// 数据分区（Phase I）：导出（选择导出弹窗留 Phase K，此处占位提示）+ 危险区清空全部数据。
import { Download, Trash2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { clearAll, sitesState } from '@/stores/sites';
import { toast } from '@/composables/useToast';

function onExport() {
  // 选择导出弹窗在 Phase K 落地；此处先给占位提示。
  toast('选择导出弹窗将在后续阶段接入', 'info');
}

function onClearAll() {
  if (!sitesState.list.length) {
    toast('已经没有数据可清空', 'info');
    return;
  }
  if (!confirm('确认清空所有站点及爬取数据？此操作不可恢复！')) return;
  clearAll();
  toast('已清空全部数据', 'success');
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
  </div>
</template>
