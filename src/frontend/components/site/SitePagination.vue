<script setup lang="ts">
// 分页条：左侧每页条数（下拉 5/10/20/50/100，向上弹出）+ 右侧页码（带「…」跳页）。
import { ref, computed } from 'vue';
import { ChevronDown, Check } from 'lucide-vue-next';
import {
  sitesState,
  totalPages,
  pageList,
  goToPage,
  setPageSize,
} from '@/stores/sites';

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100];
const menuOpen = ref(false);
const jumpAt = ref<number | null>(null); // 正在输入跳页的「…」下标
const jumpValue = ref('');

const total = computed(() => sitesState.list.length);
const info = computed(() => {
  if (!total.value) return '暂无站点';
  const start = (sitesState.currentPage - 1) * sitesState.pageSize + 1;
  const end = Math.min(sitesState.currentPage * sitesState.pageSize, total.value);
  return `共 ${total.value} 站 · ${start}-${end}`;
});
const pages = computed(() => pageList(sitesState.currentPage, totalPages.value));

function choose(n: number) {
  setPageSize(n);
  menuOpen.value = false;
}
function openJump(i: number) {
  jumpAt.value = i;
  jumpValue.value = '';
}
function confirmJump() {
  const v = parseInt(jumpValue.value, 10);
  if (v >= 1) goToPage(v);
  jumpAt.value = null;
}

// 「…」变输入框时自动聚焦
const vFocus = { mounted: (el: HTMLElement) => el.focus() };
</script>

<template>
  <div v-if="!sitesState.paginationHidden && !sitesState.groupMode" class="mt-3 flex flex-wrap items-center justify-between gap-3">
    <!-- 每页条数 -->
    <div class="relative">
      <button
        class="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent"
        @click="menuOpen = !menuOpen"
      >
        <span>每页 {{ sitesState.pageSize }} 条</span>
        <ChevronDown :size="14" />
      </button>
      <div
        v-if="menuOpen"
        class="absolute bottom-full left-0 z-40 mb-1 min-w-[7rem] overflow-hidden rounded-md border border-border bg-card py-1 shadow-lg"
      >
        <button
          v-for="n in PAGE_SIZE_OPTIONS"
          :key="n"
          class="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm"
          :class="n === sitesState.pageSize ? 'bg-accent font-medium' : 'hover:bg-accent'"
          @click="choose(n)"
        >
          <span>{{ n }} 条/页</span>
          <Check v-if="n === sitesState.pageSize" :size="14" />
        </button>
      </div>
    </div>
    <!-- 页码 -->
    <div class="flex flex-wrap items-center gap-2">
      <span class="mr-1 text-xs text-muted-foreground">{{ info }}</span>
      <div class="flex items-center gap-1">
        <template v-for="(p, i) in pages" :key="i">
          <input
            v-if="p === '...' && jumpAt === i"
            v-model="jumpValue"
            type="number"
            min="1"
            :max="totalPages"
            placeholder="页"
            class="h-8 w-16 rounded-md border border-foreground bg-background px-2 text-center text-sm outline-none focus:ring-2 focus:ring-foreground"
            @keydown.enter.prevent="confirmJump"
            @keydown.esc.prevent="jumpAt = null"
            @blur="confirmJump"
            v-focus
          />
          <button
            v-else-if="p === '...'"
            class="inline-flex h-8 min-w-8 items-center justify-center rounded-md px-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            title="点击输入页码跳转"
            @click="openJump(i)"
          >…</button>
          <button
            v-else
            class="inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-sm"
            :class="p === sitesState.currentPage
              ? 'border-foreground bg-primary text-primary-foreground'
              : 'border-border hover:bg-accent'"
            @click="goToPage(p as number)"
          >{{ p }}</button>
        </template>
      </div>
    </div>
  </div>
</template>
