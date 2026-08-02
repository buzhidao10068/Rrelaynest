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
        {{ $t('sites.batch') }}
      </Button>
      <Button
        :variant="sitesState.groupMode ? 'default' : 'outline'"
        :title="$t('sites.groupModeHint')"
        @click="toggleGroupMode"
      >
        <LayoutGrid :size="16" />
        {{ $t('sites.group') }}
      </Button>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button variant="outline" @click="$emit('openCustomize')">
        <SlidersHorizontal :size="16" />
        <span class="hidden sm:inline">{{ $t('sites.customize') }}</span>
      </Button>
      <Button variant="outline" :title="$t('sites.autoFitHint')" @click="$emit('autoFit')">
        <StretchHorizontal :size="16" />
        <span class="hidden sm:inline">{{ $t('sites.autoFit') }}</span>
      </Button>
      <Button variant="outline" @click="$emit('scrapeAll')">
        <RefreshCw :size="16" />
        <span class="hidden sm:inline">{{ $t('sites.scrapeAll') }}</span>
      </Button>
      <Button @click="$emit('create')">
        <Plus :size="16" />
        {{ $t('sites.addSite') }}
      </Button>
    </div>
  </div>
</template>
