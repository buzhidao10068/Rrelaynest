<script setup lang="ts">
// 选择性导出弹窗（Phase K）：勾选站点后导出 CSV/JSON（默认平铺 / 分组两视图）。
// 勾选态本地暂存（切视图不丢），打开时默认全选。导出内容不含 token 明文。
import { ref, computed, watch } from 'vue';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { sitesState, allGroups, type Site } from '@/stores/sites';
import { toast } from '@/composables/useToast';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

type ExportView = 'default' | 'group';
const view = ref<ExportView>('default');
// 勾选态（siteName → checked）。打开时默认全选。
const checks = ref<Record<string, boolean>>({});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    view.value = 'default';
    const init: Record<string, boolean> = {};
    sitesState.list.forEach((s) => { init[s.name] = true; });
    checks.value = init;
  },
  { immediate: true },
);

const checkedCount = computed(() => Object.values(checks.value).filter(Boolean).length);

const groups = computed(() =>
  allGroups.value.map((g) => ({
    name: g,
    sites: sitesState.list.filter((s) => (s.group || '未分组') === g),
  })),
);

function toggleSite(name: string) {
  checks.value[name] = !checks.value[name];
}
// 组标题：整组已勾则取消全组，否则补勾全组
function toggleGroup(g: string) {
  const rows = sitesState.list.filter((s) => (s.group || '未分组') === g);
  const allOn = rows.length > 0 && rows.every((s) => checks.value[s.name]);
  rows.forEach((s) => { checks.value[s.name] = !allOn; });
}
// 全选/全不选：全勾则清空，否则全勾
function toggleAll() {
  const allOn = sitesState.list.length > 0 && sitesState.list.every((s) => checks.value[s.name]);
  sitesState.list.forEach((s) => { checks.value[s.name] = !allOn; });
}

// 收集当前勾选的站点（保持主页顺序）
function collectSel(): Site[] {
  return sitesState.list.filter((s) => checks.value[s.name]);
}

const CK_TEXT: Record<string, string> = { signed: '已签', pending: '待签', off: '未启用' };

// CSV 转义：含逗号/引号/换行时包引号，内部引号翻倍
function esc(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function exportCSV(arr: Site[]) {
  const head = ['站点名称', '地址', '余额', '折算RMB', '汇率', '货币', '签到状态', '上次爬取', '注册邮箱', '备注'];
  const rows = arr.map((s) =>
    [s.name, s.url, s.bal, s.rmb, s.rate, s.cur || '', CK_TEXT[s.ck] || s.ck, s.scraped, s.email || '', s.note || '']
      .map(esc).join(','),
  );
  const csv = `﻿${head.join(',')}\n${rows.join('\n')}`; // BOM 让 Excel 正确识别 UTF-8
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), 'rrelaynest-sites.csv');
  toast(`已导出 ${arr.length} 条为 CSV`, 'success');
}

function exportJSON(arr: Site[]) {
  const data = arr.map((s) => ({
    name: s.name, url: s.url, balance: s.bal, rmb: s.rmb, rate: s.rate,
    currency: s.cur || '', checkin: s.ck, lastScraped: s.scraped,
    email: s.email || '', note: s.note || '',
  }));
  downloadBlob(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8;' }),
    'rrelaynest-sites.json',
  );
  toast(`已导出 ${arr.length} 条为 JSON`, 'success');
}

function doExport(fmt: 'csv' | 'json') {
  const sel = collectSel();
  if (!sel.length) { toast('请至少勾选一个站点', 'info'); return; }
  if (fmt === 'csv') exportCSV(sel);
  else exportJSON(sel);
  emit('close');
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent class="flex max-h-[calc(100vh-2rem)] max-w-[460px] flex-col">
      <DialogHeader>
        <DialogTitle>选择导出站点</DialogTitle>
        <DialogDescription>
          勾选要导出的站点，再选择导出格式；不勾选则默认导出全部。导出内容不含 token 明文。
        </DialogDescription>
      </DialogHeader>

      <!-- 视图切换 + 全选 -->
      <div class="flex items-center gap-2">
        <Button
          :variant="view === 'default' ? 'default' : 'outline'"
          size="sm"
          @click="view = 'default'"
        >默认</Button>
        <Button
          :variant="view === 'group' ? 'default' : 'outline'"
          size="sm"
          @click="view = 'group'"
        >分组</Button>
        <Button variant="ghost" size="sm" class="ml-auto" @click="toggleAll">全选/全不选</Button>
      </div>

      <!-- 列表 -->
      <div class="-mx-1 flex-1 overflow-y-auto px-1">
        <div v-if="!sitesState.list.length" class="p-6 text-center text-sm text-muted-foreground">
          暂无站点
        </div>

        <!-- 默认平铺 -->
        <div v-else-if="view === 'default'" class="space-y-0.5">
          <div
            v-for="s in sitesState.list"
            :key="s.name"
            class="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-accent"
            @click="toggleSite(s.name)"
          >
            <Checkbox :model-value="!!checks[s.name]" class="pointer-events-none" />
            <span class="min-w-0 flex-1 truncate text-sm">{{ s.name }}</span>
            <span class="shrink-0 text-xs text-muted-foreground">{{ s.group || '未分组' }}</span>
          </div>
        </div>

        <!-- 分组 -->
        <div v-else class="space-y-3">
          <div v-for="g in groups" :key="g.name" class="space-y-0.5">
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-md bg-muted/40 px-3 py-1.5 text-left text-xs font-semibold hover:bg-muted/70"
              @click="toggleGroup(g.name)"
            >
              <span>{{ g.name }}</span>
              <span class="rounded-full bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {{ g.sites.length }} 站
              </span>
            </button>
            <div
              v-for="s in g.sites"
              :key="s.name"
              class="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-accent"
              @click="toggleSite(s.name)"
            >
              <Checkbox :model-value="!!checks[s.name]" class="pointer-events-none" />
              <span class="min-w-0 flex-1 truncate text-sm">{{ s.name }}</span>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter class="items-center sm:justify-between">
        <span class="text-xs text-muted-foreground">已选 {{ checkedCount }} / {{ sitesState.list.length }} 个站点</span>
        <div class="flex gap-2">
          <Button variant="outline" @click="emit('close')">取消</Button>
          <Button variant="outline" @click="doExport('csv')">导出 CSV</Button>
          <Button @click="doExport('json')">导出 JSON</Button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
