<script setup lang="ts">
// 站点表格工具条：批量 / 分组（左）；自定义 / 自动调整 / 全部爬取 / 新增站点（右）。
import { CheckSquare, LayoutGrid, SlidersHorizontal, StretchHorizontal, RefreshCw, Plus } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { sitesState, toggleBatch, toggleGroupMode } from '@/stores/sites';

defineEmits<{
  (e: 'openCustomize'): void;
  (e: 'autoFit'): void;
  (e: 'scrapeAll'): void;
  (e: 'create'): void;
}>();
</script>

<template>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <div class="flex flex-wrap gap-2">
      <Button :variant="sitesState.batchMode ? 'default' : 'outline'" @click="toggleBatch">
        <CheckSquare :size="16" />
        批量
      </Button>
      <Button
        :variant="sitesState.groupMode ? 'default' : 'outline'"
        title="按分组分区展示（分组时不分页）"
        @click="toggleGroupMode"
      >
        <LayoutGrid :size="16" />
        分组
      </Button>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button variant="outline" @click="$emit('openCustomize')">
        <SlidersHorizontal :size="16" />
        <span class="hidden sm:inline">自定义</span>
      </Button>
      <Button variant="outline" title="按内容自动调整各列宽度" @click="$emit('autoFit')">
        <StretchHorizontal :size="16" />
        <span class="hidden sm:inline">自动调整</span>
      </Button>
      <Button variant="outline" @click="$emit('scrapeAll')">
        <RefreshCw :size="16" />
        <span class="hidden sm:inline">全部爬取</span>
      </Button>
      <Button @click="$emit('create')">
        <Plus :size="16" />
        新增站点
      </Button>
    </div>
  </div>
</template>
