<script setup lang="ts">
// 站点表格主体：表头（可排序/可拖拽调宽）+ 行（签到徽章 / 无 token 警告 / 行内操作 / 拖拽重排）
// + 分组分区（可折叠、跨组拖拽改分组）。分页条与自定义面板由父组件挂载。
// 块8：键与操作事件改为按 id；充值按钮与「已签金额」徽章砍掉（余额爬取权威、无客户端记账）。
import { ref, computed } from 'vue';
import {
  ArrowUpDown, ArrowUp, ArrowDown, GripVertical,
  RefreshCw, CalendarCheck, Pencil, Trash2,
  ChevronRight, ChevronDown, Check, Minus, TriangleAlert,
} from 'lucide-vue-next';
import {
  sitesState, visibleColumns, pagedSites, groupedSites,
  toggleSort,
  toggleSelect, toggleGroup, toggleGroupSelect,
  setColWidth, reorderRow, moveToGroup,
  ACTION_COL_W, MIN_COL_W, type Site,
} from '@/stores/sites';

const emit = defineEmits<{
  (e: 'scrape', id: number): void;
  (e: 'checkin', id: number): void;
  (e: 'edit', id: number): void;
  (e: 'delete', id: number): void;
  (e: 'openAddr', host: string): void;
}>();

const cols = visibleColumns;
const pad = computed(() => (sitesState.compact ? 'px-4 py-1.5' : 'px-4 py-3'));
const tableMinW = computed(
  () => cols.value.reduce((a, c) => a + (c.width || 0), 0) + ACTION_COL_W,
);

// ---- 行是否可拖：非批量 + （分组模式 或 未排序）----
const rowDraggable = computed(
  () => !sitesState.batchMode && (sitesState.groupMode || !sitesState.sortKey),
);

function cellText(s: Site, key: string): string {
  switch (key) {
    case 'bal': return s.bal;
    case 'rmb': return s.rmb;
    case 'rate': return s.rate;
    case 'scraped': return s.scraped;
    default: return '';
  }
}

// ---- 表头排序图标 ----
function sortState(key: string): 'asc' | 'desc' | null {
  return sitesState.sortKey === key ? sitesState.sortDir : null;
}

// ---- 列宽拖拽 ----
let resizeState: { key: string; startX: number; startW: number } | null = null;
function startResize(e: MouseEvent | TouchEvent, key: string) {
  e.preventDefault();
  e.stopPropagation();
  const col = sitesState.columns.find((c) => c.key === key);
  if (!col) return;
  const startX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  resizeState = { key, startX, startW: col.width };
  document.body.style.cursor = 'col-resize';
  window.addEventListener('mousemove', onResizeMove);
  window.addEventListener('mouseup', endResize);
  window.addEventListener('touchmove', onResizeMove, { passive: false });
  window.addEventListener('touchend', endResize);
}
function onResizeMove(e: MouseEvent | TouchEvent) {
  if (!resizeState) return;
  if (e.cancelable) e.preventDefault();
  const x = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const w = Math.max(MIN_COL_W, Math.round(resizeState.startW + (x - resizeState.startX)));
  setColWidth(resizeState.key, w);
}
function endResize() {
  resizeState = null;
  document.body.style.cursor = '';
  window.removeEventListener('mousemove', onResizeMove);
  window.removeEventListener('mouseup', endResize);
  window.removeEventListener('touchmove', onResizeMove);
  window.removeEventListener('touchend', endResize);
}

// ---- 批量选择点状态（按 id）----
function isSelected(id: number): boolean {
  return sitesState.selected.has(id);
}
function groupSelState(rows: Site[]): 'all' | 'some' | 'none' {
  const total = rows.length;
  const sel = rows.reduce((a, s) => a + (isSelected(s.id) ? 1 : 0), 0);
  if (total > 0 && sel === total) return 'all';
  if (sel > 0) return 'some';
  return 'none';
}

// ---- 行点击（批量模式下点整行 = 选中，点按钮/链接放行）----
function onRowClick(e: MouseEvent, id: number) {
  if (!sitesState.batchMode) return;
  if ((e.target as HTMLElement).closest('button, a')) return;
  toggleSelect(id);
}

// ---- 行拖拽重排 ----
const dragId = ref<number | null>(null);
const dragOverId = ref<number | null>(null);
const dragOverDir = ref<'top' | 'bottom'>('bottom');
const dragOverGroup = ref<string | null>(null);
// 仅从 6 点手柄按下才允许拖：mousedown 手柄 → 记下该行 id 使其 draggable；
// 抬起/拖完再清空，避免选字、点按钮误触发拖拽。
const armedId = ref<number | null>(null);
function armGrip(id: number) {
  armedId.value = id;
  const clear = () => { armedId.value = null; window.removeEventListener('mouseup', clear); };
  window.addEventListener('mouseup', clear);
}
function onDragStart(e: DragEvent, id: number) {
  if (armedId.value !== id) { e.preventDefault(); return; }
  dragId.value = id;
  e.dataTransfer!.effectAllowed = 'move';
  try { e.dataTransfer!.setData('text/plain', String(id)); } catch { /* noop */ }
}
function onDragEnd() {
  dragId.value = null;
  dragOverId.value = null;
  dragOverGroup.value = null;
  armedId.value = null;
}
function onRowDragOver(e: DragEvent, s: Site) {
  if (dragId.value === null || s.id === dragId.value) return;
  e.preventDefault();
  e.dataTransfer!.dropEffect = 'move';
  const fromIdx = sitesState.list.findIndex((x) => x.id === dragId.value);
  const overIdx = sitesState.list.findIndex((x) => x.id === s.id);
  dragOverId.value = s.id;
  dragOverDir.value = overIdx > fromIdx ? 'bottom' : 'top';
}
function onRowDrop(s: Site) {
  if (dragId.value === null || dragId.value === s.id) return;
  const intoGroup = sitesState.groupMode ? (s.group || '未分组') : undefined;
  void reorderRow(dragId.value, s.id, intoGroup);
  onDragEnd();
}
function onGroupDragOver(e: DragEvent, g: string) {
  if (dragId.value === null) return;
  e.preventDefault();
  e.dataTransfer!.dropEffect = 'move';
  dragOverGroup.value = g;
}
function onGroupDrop(g: string) {
  if (dragId.value === null) return;
  void moveToGroup(dragId.value, g);
  onDragEnd();
}

// 行内操作按钮的禁用/提示逻辑
function checkinDisabled(s: Site): boolean {
  return !s.hasToken && s.ck === 'off';
}
function checkinTitle(s: Site): string {
  if (!s.hasToken) return '未设置 Access Token，无法签到';
  if (s.ck === 'off') return '该站未启用签到，请在编辑中开启';
  return '立即签到';
}
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-border bg-card">
    <table class="w-full text-sm" :style="{ tableLayout: 'fixed', minWidth: tableMinW + 'px' }">
      <!-- 表头 -->
      <thead>
        <tr class="border-b border-border text-left text-muted-foreground">
          <th
            v-for="c in cols"
            :key="c.key"
            class="relative select-none px-4 py-3 font-medium"
            :style="{ width: c.width + 'px' }"
          >
            <button
              v-if="c.sortable"
              class="inline-flex max-w-full items-center gap-1 truncate hover:text-foreground"
              @click="toggleSort(c.key)"
            >
              {{ c.label }}
              <ArrowUp v-if="sortState(c.key) === 'asc'" :size="14" class="text-foreground" />
              <ArrowDown v-else-if="sortState(c.key) === 'desc'" :size="14" class="text-foreground" />
              <ArrowUpDown v-else :size="14" class="opacity-40" />
            </button>
            <span v-else class="block truncate">{{ c.label }}</span>
            <span
              class="col-resizer"
              title="拖拽调整列宽"
              @mousedown="startResize($event, c.key)"
              @touchstart="startResize($event, c.key)"
            ></span>
          </th>
          <th class="px-4 py-3 text-right font-medium" :style="{ width: ACTION_COL_W + 'px' }">操作</th>
        </tr>
      </thead>

      <!-- 分组模式 -->
      <tbody v-if="sitesState.groupMode">
        <template v-for="grp in groupedSites" :key="grp.group">
          <tr
            class="cursor-pointer border-b border-border bg-muted/40 hover:bg-muted/70"
            :class="dragOverGroup === grp.group ? 'ring-2 ring-inset ring-foreground' : ''"
            @click="sitesState.batchMode ? toggleGroupSelect(grp.group) : toggleGroup(grp.group)"
            @dragover="onGroupDragOver($event, grp.group)"
            @dragleave="dragOverGroup = null"
            @drop="onGroupDrop(grp.group)"
          >
            <td :colspan="cols.length + 1" class="px-4 py-2">
              <span class="inline-flex items-center gap-2 text-sm font-semibold">
                <!-- 批量：组选择点；否则折叠箭头 -->
                <template v-if="sitesState.batchMode">
                  <span
                    class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition"
                    :class="groupSelState(grp.rows) !== 'none'
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-muted-foreground bg-background'"
                  >
                    <Check v-if="groupSelState(grp.rows) === 'all'" :size="12" :stroke-width="3" />
                    <Minus v-else-if="groupSelState(grp.rows) === 'some'" :size="12" :stroke-width="3" />
                  </span>
                </template>
                <template v-else>
                  <ChevronRight v-if="sitesState.collapsedGroups[grp.group]" :size="16" />
                  <ChevronDown v-else :size="16" />
                </template>
                <span>{{ grp.group }}</span>
                <span class="rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {{ grp.rows.length }} 站
                </span>
                <span class="text-xs font-normal text-muted-foreground">
                  合计 ¥{{ grp.sum.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }}
                </span>
              </span>
            </td>
          </tr>
          <template v-if="!sitesState.collapsedGroups[grp.group]">
            <tr
              v-for="s in grp.rows"
              :key="s.id"
              :draggable="rowDraggable && armedId === s.id ? true : undefined"
              class="group/row border-b border-border last:border-0 hover:bg-accent/40"
              :class="[
                sitesState.batchMode ? 'cursor-pointer' : '',
                isSelected(s.id) ? 'bg-accent/40' : '',
                dragId === s.id ? 'opacity-40' : '',
                dragOverId === s.id && dragOverDir === 'top' ? 'border-t-2 border-t-foreground' : '',
                dragOverId === s.id && dragOverDir === 'bottom' ? 'border-b-2 border-b-foreground' : '',
              ]"
              @click="onRowClick($event, s.id)"
              @dragstart="onDragStart($event, s.id)"
              @dragend="onDragEnd"
              @dragover="onRowDragOver($event, s)"
              @dragleave="dragOverId = null"
              @drop="onRowDrop(s)"
            >
              <td
                v-for="c in cols"
                :key="c.key"
                class="truncate"
                :class="[pad, c.key === 'name' ? 'font-medium' : '', ['url', 'rate', 'scraped'].includes(c.key) ? 'text-muted-foreground' : '']"
              >
                <!-- 站点名称：手柄 + 选择点 + 名称 + 无token警告 -->
                <template v-if="c.key === 'name'">
                  <span class="flex items-center">
                    <span class="truncate">
                      <span
                        v-if="rowDraggable"
                        class="row-grip mr-2 inline-flex h-5 w-4 shrink-0 cursor-grab items-center justify-center align-middle text-muted-foreground opacity-0 transition group-hover/row:opacity-100 active:cursor-grabbing"
                        title="按住拖动重排"
                        @mousedown="armGrip(s.id)"
                      >
                        <GripVertical :size="14" />
                      </span>
                      <span
                        v-if="sitesState.batchMode"
                        class="mr-3 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border align-middle transition"
                        :class="isSelected(s.id)
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-muted-foreground bg-background'"
                      >
                        <Check v-if="isSelected(s.id)" :size="12" :stroke-width="3" />
                      </span>
                      {{ s.name }}
                    </span>
                    <span v-if="!s.hasToken" class="group relative ml-1.5 inline-flex align-middle">
                      <TriangleAlert :size="16" class="text-red-500" />
                      <span
                        role="tooltip"
                        class="pointer-events-none absolute bottom-full left-0 z-[100] mb-2 hidden w-56 rounded-md bg-foreground px-3 py-2 text-xs leading-relaxed text-background shadow-lg group-hover:block"
                      >
                        未设置 Access Token，无法爬取余额与签到。点击行内「编辑」补充 Token 后即可启用。
                      </span>
                    </span>
                  </span>
                </template>
                <!-- 地址：可点链接 -->
                <template v-else-if="c.key === 'url'">
                  <a
                    :href="'https://' + s.url"
                    class="truncate underline-offset-2 hover:text-foreground hover:underline"
                    @click="emit('openAddr', s.url)"
                  >{{ s.url }}</a>
                </template>
                <!-- 签到徽章 -->
                <template v-else-if="c.key === 'ck'">
                  <span
                    v-if="s.ck === 'signed'"
                    class="inline-flex items-center gap-1 rounded-md bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400"
                  >● 已签</span>
                  <span
                    v-else-if="s.ck === 'pending'"
                    class="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400"
                  >● 待签</span>
                  <span
                    v-else
                    class="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                  >● 未启用</span>
                </template>
                <template v-else>{{ cellText(s, c.key) }}</template>
              </td>
              <!-- 操作列 -->
              <td :class="pad">
                <div class="flex justify-end gap-1">
                  <button
                    class="flex h-8 w-8 items-center justify-center rounded-md"
                    :class="s.hasToken ? 'text-muted-foreground hover:bg-accent' : 'cursor-not-allowed text-muted-foreground opacity-50'"
                    :disabled="!s.hasToken"
                    :title="s.hasToken ? '爬取' : '未设置 Access Token，无法爬取'"
                    @click="emit('scrape', s.id)"
                  ><RefreshCw :size="15" /></button>
                  <button
                    class="flex h-8 w-8 items-center justify-center rounded-md"
                    :class="checkinDisabled(s) ? 'cursor-not-allowed text-muted-foreground opacity-50' : 'text-muted-foreground hover:bg-accent'"
                    :disabled="checkinDisabled(s)"
                    :title="checkinTitle(s)"
                    @click="emit('checkin', s.id)"
                  ><CalendarCheck :size="15" /></button>
                  <button
                    class="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                    title="编辑"
                    @click="emit('edit', s.id)"
                  ><Pencil :size="15" /></button>
                  <button
                    class="flex h-8 w-8 items-center justify-center rounded-md text-red-500 hover:bg-accent"
                    title="删除"
                    @click="emit('delete', s.id)"
                  ><Trash2 :size="15" /></button>
                </div>
              </td>
            </tr>
          </template>
        </template>
      </tbody>

      <!-- 平铺模式（分页切片）-->
      <tbody v-else>
        <tr
          v-for="s in pagedSites"
          :key="s.id"
          :draggable="rowDraggable && armedId === s.id ? true : undefined"
          class="group/row border-b border-border last:border-0 hover:bg-accent/40"
          :class="[
            sitesState.batchMode ? 'cursor-pointer' : '',
            isSelected(s.id) ? 'bg-accent/40' : '',
            dragId === s.id ? 'opacity-40' : '',
            dragOverId === s.id && dragOverDir === 'top' ? 'border-t-2 border-t-foreground' : '',
            dragOverId === s.id && dragOverDir === 'bottom' ? 'border-b-2 border-b-foreground' : '',
          ]"
          @click="onRowClick($event, s.id)"
          @dragstart="onDragStart($event, s.id)"
          @dragend="onDragEnd"
          @dragover="onRowDragOver($event, s)"
          @dragleave="dragOverId = null"
          @drop="onRowDrop(s)"
        >
          <td
            v-for="c in cols"
            :key="c.key"
            class="truncate"
            :class="[pad, c.key === 'name' ? 'font-medium' : '', ['url', 'rate', 'scraped'].includes(c.key) ? 'text-muted-foreground' : '']"
          >
            <template v-if="c.key === 'name'">
              <span class="flex items-center">
                <span class="truncate">
                  <span
                    v-if="rowDraggable"
                    class="row-grip mr-2 inline-flex h-5 w-4 shrink-0 cursor-grab items-center justify-center align-middle text-muted-foreground opacity-0 transition group-hover/row:opacity-100 active:cursor-grabbing"
                    title="按住拖动重排"
                    @mousedown="armGrip(s.id)"
                  >
                    <GripVertical :size="14" />
                  </span>
                  <span
                    v-if="sitesState.batchMode"
                    class="mr-3 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border align-middle transition"
                    :class="isSelected(s.id)
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-muted-foreground bg-background'"
                  >
                    <Check v-if="isSelected(s.id)" :size="12" :stroke-width="3" />
                  </span>
                  {{ s.name }}
                </span>
                <span v-if="!s.hasToken" class="group relative ml-1.5 inline-flex align-middle">
                  <TriangleAlert :size="16" class="text-red-500" />
                  <span
                    role="tooltip"
                    class="pointer-events-none absolute bottom-full left-0 z-[100] mb-2 hidden w-56 rounded-md bg-foreground px-3 py-2 text-xs leading-relaxed text-background shadow-lg group-hover:block"
                  >
                    未设置 Access Token，无法爬取余额与签到。点击行内「编辑」补充 Token 后即可启用。
                  </span>
                </span>
              </span>
            </template>
            <template v-else-if="c.key === 'url'">
              <a
                :href="'https://' + s.url"
                class="truncate underline-offset-2 hover:text-foreground hover:underline"
                @click="emit('openAddr', s.url)"
              >{{ s.url }}</a>
            </template>
            <template v-else-if="c.key === 'ck'">
              <span
                v-if="s.ck === 'signed'"
                class="inline-flex items-center gap-1 rounded-md bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400"
              >● 已签</span>
              <span
                v-else-if="s.ck === 'pending'"
                class="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400"
              >● 待签</span>
              <span
                v-else
                class="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
              >● 未启用</span>
            </template>
            <template v-else>{{ cellText(s, c.key) }}</template>
          </td>
          <td :class="pad">
            <div class="flex justify-end gap-1">
              <button
                class="flex h-8 w-8 items-center justify-center rounded-md"
                :class="s.hasToken ? 'text-muted-foreground hover:bg-accent' : 'cursor-not-allowed text-muted-foreground opacity-50'"
                :disabled="!s.hasToken"
                :title="s.hasToken ? '爬取' : '未设置 Access Token，无法爬取'"
                @click="emit('scrape', s.id)"
              ><RefreshCw :size="15" /></button>
              <button
                class="flex h-8 w-8 items-center justify-center rounded-md"
                :class="checkinDisabled(s) ? 'cursor-not-allowed text-muted-foreground opacity-50' : 'text-muted-foreground hover:bg-accent'"
                :disabled="checkinDisabled(s)"
                :title="checkinTitle(s)"
                @click="emit('checkin', s.id)"
              ><CalendarCheck :size="15" /></button>
              <button
                class="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                title="编辑"
                @click="emit('edit', s.id)"
              ><Pencil :size="15" /></button>
              <button
                class="flex h-8 w-8 items-center justify-center rounded-md text-red-500 hover:bg-accent"
                title="删除"
                @click="emit('delete', s.id)"
              ><Trash2 :size="15" /></button>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
