<script setup lang="ts">
// 批量操作浮条：毛玻璃，批量模式时从底部浮现。已选数 + 全选/取消全选 + 删除 + 取消。
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { Trash2 } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { sitesState, selectAll, toggleBatch } from '@/stores/sites';

defineEmits<{ (e: 'delete'): void }>();

const { t } = useI18n({ useScope: 'global' });

const count = computed(() => sitesState.selected.size);
const allLabel = computed(
  () => (count.value === sitesState.list.length && sitesState.list.length ? t('sites.deselectAll') : t('sites.selectAll')),
);
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-6 z-30 flex justify-center transition-all duration-300"
    :class="sitesState.batchMode ? 'translate-y-0 opacity-100' : 'translate-y-24 opacity-0'"
  >
    <div
      class="pointer-events-auto flex items-center gap-3 rounded-2xl border border-white/20 bg-white/10 px-3 py-2 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-white/5"
      style="-webkit-backdrop-filter: saturate(180%) blur(20px); backdrop-filter: saturate(180%) blur(20px);"
    >
      <span class="pl-2 text-sm font-medium">{{ $t('sites.selectedN', { n: count }) }}</span>
      <span class="h-5 w-px bg-border"></span>
      <Button variant="ghost" size="sm" class="rounded-lg" @click="selectAll">
        {{ allLabel }}
      </Button>
      <Button variant="destructive" size="sm" class="rounded-lg" @click="$emit('delete')">
        <Trash2 :size="15" />
        {{ $t('common.delete') }}
      </Button>
      <span class="h-5 w-px bg-border"></span>
      <Button variant="ghost" size="sm" class="rounded-lg text-muted-foreground" @click="toggleBatch">
        {{ $t('common.cancel') }}
      </Button>
    </div>
  </div>
</template>
