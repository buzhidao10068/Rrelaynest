<script setup lang="ts">
// 自定义视图面板：右侧滑出（无遮罩，左侧表格实时可见）。
// 紧凑模式开关 + 列显隐/拖拽重排 + 恢复默认。
import { computed } from 'vue';
import { Settings2, X } from 'lucide-vue-next';
import {
  sitesState,
  toggleCompact,
  toggleColVisible,
  moveColumn,
  resetCustomize,
} from '@/stores/sites';
import Switch from '@/components/ui/switch/Switch.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const columns = computed(() => sitesState.columns);

// HTML5 拖拽重排列顺序
let dragFrom = -1;
function onDragStart(i: number) { dragFrom = i; }
function onDrop(i: number) {
  if (dragFrom >= 0 && dragFrom !== i) moveColumn(dragFrom, i);
  dragFrom = -1;
}
</script>

<template>
  <aside
    class="fixed inset-y-0 right-0 z-40 flex w-[320px] max-w-[85vw] flex-col border-l border-border bg-card shadow-xl transition-transform duration-300"
    :class="props.open ? 'translate-x-0' : 'translate-x-full'"
  >
    <div class="flex items-center gap-2 border-b border-border px-4 py-4">
      <Settings2 :size="18" />
      <span class="text-base font-semibold">{{ $t('sites.customizeTitle') }}</span>
      <button
        class="ml-auto flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent"
        :title="$t('common.close')"
        @click="emit('close')"
      >
        <X :size="18" />
      </button>
    </div>

    <div class="flex-1 space-y-6 overflow-y-auto p-4">
      <!-- 紧凑模式 -->
      <div class="flex items-center gap-3 rounded-lg border border-border p-3">
        <Switch :model-value="sitesState.compact" @update:model-value="toggleCompact" />
        <div>
          <p class="text-sm font-medium">{{ $t('sites.compactMode') }}</p>
          <p class="text-xs text-muted-foreground">{{ $t('sites.compactHint') }}</p>
        </div>
      </div>

      <!-- 列显示 + 拖拽排序 -->
      <div>
        <p class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {{ $t('sites.columnsHeader') }}
        </p>
        <div class="mt-2 space-y-1">
          <div
            v-for="(c, i) in columns"
            :key="c.key"
            draggable="true"
            class="flex cursor-grab items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent active:cursor-grabbing"
            @dragstart="onDragStart(i)"
            @dragover.prevent
            @drop.prevent="onDrop(i)"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg" width="14" height="14"
              viewBox="0 0 24 24" fill="currentColor"
              class="shrink-0 text-muted-foreground"
            >
              <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
              <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
              <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
            </svg>
            <span class="flex-1 text-sm">{{ $t(c.labelKey) }}</span>
            <Switch
              :model-value="c.visible"
              :disabled="c.always"
              @update:model-value="toggleColVisible(c.key)"
            />
          </div>
        </div>
      </div>
    </div>

    <div class="border-t border-border p-4">
      <button
        class="w-full rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
        @click="resetCustomize"
      >
        {{ $t('sites.resetDefault') }}
      </button>
    </div>
  </aside>
</template>
