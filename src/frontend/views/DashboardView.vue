<script setup lang="ts">
// 站点主页（Phase D/E）：顶栏 + 统计卡 + 工具条 + 表格 + 分页 + 批量栏 + 自定义面板
// + 编辑/充值/手动签到三弹窗（Phase E）。
import { ref } from 'vue';
import AppHeader from '@/components/AppHeader.vue';
import {
  stats,
  scrapeSite,
  deleteSite,
  checkinSite,
  batchDelete,
  findSite,
  type Site,
} from '@/stores/sites';
import { toast } from '@/composables/useToast';
import SiteToolbar from '@/components/site/SiteToolbar.vue';
import SiteTable from '@/components/site/SiteTable.vue';
import SitePagination from '@/components/site/SitePagination.vue';
import BatchBar from '@/components/site/BatchBar.vue';
import CustomizePanel from '@/components/site/CustomizePanel.vue';
import SiteEditorModal from '@/components/site/SiteEditorModal.vue';
import CheckinModal from '@/components/site/CheckinModal.vue';
import RechargeModal from '@/components/site/RechargeModal.vue';

const customizeOpen = ref(false);

// 三弹窗状态：editor 复用 新增(editing=null)/编辑(editing=Site)
const editorOpen = ref(false);
const editorSite = ref<Site | null>(null);
const checkinOpen = ref(false);
const checkinSiteRef = ref<Site | null>(null);
const rechargeOpen = ref(false);
const rechargeSiteRef = ref<Site | null>(null);

function onScrape(name: string) {
  if (scrapeSite(name)) toast('已爬取「' + name + '」余额', 'success');
}
function onCheckin(name: string) {
  const r = checkinSite(name);
  if (r.status === 'done') {
    toast('「' + name + '」签到成功，到账 ' + r.amountText + '，余额 ' + r.balanceText, 'success');
  } else if (r.status === 'already') {
    toast('「' + name + '」今日已签到', 'info');
  } else if (r.status === 'need-amount') {
    // 无默认金额：弹窗手动填本次到账金额
    checkinSiteRef.value = findSite(name) ?? null;
    checkinOpen.value = true;
  }
}
function onRecharge(name: string) {
  rechargeSiteRef.value = findSite(name) ?? null;
  rechargeOpen.value = true;
}
function onEdit(name: string) {
  editorSite.value = findSite(name) ?? null;
  editorOpen.value = true;
}
function onDelete(name: string) {
  if (!confirm('确认删除站点「' + name + '」？此操作不可恢复。')) return;
  if (deleteSite(name)) toast('已删除「' + name + '」', 'success');
}
function onOpenAddr(host: string) {
  // PC：交给 <a> 默认行为（新标签）；此处不额外处理，移动端确认在 Phase 后续补
  void host;
}
function onAutoFit() {
  toast('自动调整列宽将在后续补测量逻辑', 'info');
}
function onScrapeAll() {
  toast('全部爬取将在 Phase H 接爬虫设置', 'info');
}
function onCreate() {
  editorSite.value = null;
  editorOpen.value = true;
}
function onBatchDelete() {
  const n = batchDelete();
  if (n) toast('已删除 ' + n + ' 个站点', 'success');
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
          @recharge="onRecharge"
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
    <SiteEditorModal :open="editorOpen" :editing="editorSite" @close="editorOpen = false" />

    <!-- 手动签到弹窗 -->
    <CheckinModal :open="checkinOpen" :site="checkinSiteRef" @close="checkinOpen = false" />

    <!-- 充值弹窗 -->
    <RechargeModal :open="rechargeOpen" :site="rechargeSiteRef" @close="rechargeOpen = false" />
  </div>
</template>
