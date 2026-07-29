<script setup lang="ts">
// 站点主页（块8：接线后端）：顶栏 + 统计卡 + 工具条 + 表格 + 分页 + 批量栏 + 自定义面板
// + 编辑/新增弹窗。充值/手动签到弹窗本轮砍掉（余额爬取权威、签到走后端 /checkin）。
import { ref, onMounted } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import {
  stats,
  loadSites,
  scrapeSite,
  scrapeAll,
  deleteSite,
  checkinSite,
  batchDelete,
  findSite,
  type Site,
} from '@/stores/sites';
import { loadProxies } from '@/stores/proxies';
import { loadSettings } from '@/stores/settings';
import { ApiError } from '@/api';
import { toast } from '@/composables/useToast';
import SiteToolbar from '@/components/site/SiteToolbar.vue';
import SiteTable from '@/components/site/SiteTable.vue';
import SitePagination from '@/components/site/SitePagination.vue';
import BatchBar from '@/components/site/BatchBar.vue';
import CustomizePanel from '@/components/site/CustomizePanel.vue';
import SiteEditorModal from '@/components/site/SiteEditorModal.vue';

const customizeOpen = ref(false);

// 编辑弹窗状态：复用 新增(editing=null)/编辑(editing=Site)
const editorOpen = ref(false);
const editorSite = ref<Site | null>(null);
const scrapingAll = ref(false);

function errMsg(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

onMounted(async () => {
  try {
    await Promise.all([loadSites(), loadProxies(), loadSettings()]);
  } catch (e) {
    toast(errMsg(e, '加载站点失败'), 'error');
  }
});

async function onScrape(id: number) {
  const s = findSite(id);
  const nm = s?.name ?? '';
  try {
    const r = await scrapeSite(id);
    if (r.ok) toast('已爬取「' + nm + '」余额', 'success');
    else toast('「' + nm + '」爬取失败：' + (r.error ?? '未知错误'), 'error');
  } catch (e) {
    toast(errMsg(e, '爬取失败'), 'error');
  }
}
async function onCheckin(id: number) {
  const s = findSite(id);
  const nm = s?.name ?? '';
  try {
    const r = await checkinSite(id);
    if (r.ok) toast('「' + nm + '」签到成功：' + (r.result ?? '已签到'), 'success');
    else if (r.needs_manual) toast('「' + nm + '」需人工验证：' + (r.result ?? ''), 'info');
    else toast('「' + nm + '」签到失败：' + (r.result ?? '未知错误'), 'error');
  } catch (e) {
    toast(errMsg(e, '签到失败'), 'error');
  }
}
function onEdit(id: number) {
  editorSite.value = findSite(id) ?? null;
  editorOpen.value = true;
}
async function onDelete(id: number) {
  const s = findSite(id);
  const nm = s?.name ?? '';
  if (!confirm('确认删除站点「' + nm + '」？此操作不可恢复。')) return;
  try {
    await deleteSite(id);
    toast('已删除「' + nm + '」', 'success');
  } catch (e) {
    toast(errMsg(e, '删除失败'), 'error');
  }
}
function onOpenAddr(host: string) {
  // PC：交给 <a> 默认行为（新标签）；此处不额外处理。
  void host;
}
function onAutoFit() {
  toast('自动调整列宽将在后续补测量逻辑', 'info');
}
async function onScrapeAll() {
  if (scrapingAll.value) return;
  scrapingAll.value = true;
  toast('开始爬取全部站点…', 'info');
  try {
    const results = await scrapeAll();
    const ok = results.filter((r) => r.ok).length;
    toast(`全部爬取完成：${ok}/${results.length} 成功`, ok === results.length ? 'success' : 'info');
  } catch (e) {
    toast(errMsg(e, '全部爬取失败'), 'error');
  } finally {
    scrapingAll.value = false;
  }
}
function onCreate() {
  editorSite.value = null;
  editorOpen.value = true;
}
async function onBatchDelete() {
  try {
    const n = await batchDelete();
    if (n) toast('已删除 ' + n + ' 个站点', 'success');
  } catch (e) {
    toast(errMsg(e, '批量删除失败'), 'error');
  }
}
// 弹窗保存后重拉列表由 store 内部完成，这里只需关闭。
function onEditorClose() {
  editorOpen.value = false;
}
</script>

<template>
  <div class="min-h-screen bg-background">
    <!-- 顶栏 -->
    <AppHeader title="站点" />

    <div class="space-y-6 p-4 sm:p-6">
      <!-- 统计卡 -->
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div class="rounded-lg border border-border bg-card p-5">
          <p class="text-sm text-muted-foreground">站点总数</p>
          <p class="mt-1 text-3xl font-semibold">{{ stats.total }}</p>
        </div>
        <div class="rounded-lg border border-border bg-card p-5">
          <p class="text-sm text-muted-foreground">合计余额</p>
          <p class="mt-1 text-3xl font-semibold">{{ stats.balance }}</p>
        </div>
        <div class="rounded-lg border border-border bg-card p-5">
          <p class="text-sm text-muted-foreground">今日已签到</p>
          <p class="mt-1 text-3xl font-semibold">{{ stats.checkin }}</p>
        </div>
      </div>

      <!-- 工具条 -->
      <SiteToolbar
        @open-customize="customizeOpen = true"
        @auto-fit="onAutoFit"
        @scrape-all="onScrapeAll"
        @create="onCreate"
      />

      <!-- 表格 + 分页 -->
      <div>
        <SiteTable
          @scrape="onScrape"
          @checkin="onCheckin"
          @edit="onEdit"
          @delete="onDelete"
          @open-addr="onOpenAddr"
        />
        <SitePagination />
      </div>
    </div>

    <!-- 批量浮动栏 -->
    <BatchBar @batch-delete="onBatchDelete" />

    <!-- 自定义面板 -->
    <CustomizePanel :open="customizeOpen" @close="customizeOpen = false" />

    <!-- 编辑/新增弹窗 -->
    <SiteEditorModal :open="editorOpen" :editing="editorSite" @close="onEditorClose" />
  </div>
</template>
