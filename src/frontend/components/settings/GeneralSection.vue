<script setup lang="ts">
// 通用偏好分区：默认货币显示、隐藏分页开关、部署平台检测 + 平台功能过滤。
import { computed } from 'vue';
import { RefreshCw, RotateCw } from 'lucide-vue-next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { settingsState, persistCurrency } from '@/stores/settings';
import { sitesState, setPaginationHidden } from '@/stores/sites';
import { ui, setDeployPlatform, type DeployPlatform } from '@/stores/ui';
import { toast } from '@/composables/useToast';

// 隐藏分页：唯一事实来源在 sites store
const hidePagination = computed({
  get: () => sitesState.paginationHidden,
  set: (v: boolean) => {
    setPaginationHidden(v);
    toast(v ? '已隐藏分页：主页平铺全部站点' : '已恢复分页', 'info');
  },
});

function platformLabel(p: DeployPlatform): string {
  return p === 'workers' ? 'Cloudflare' : 'Docker';
}
const platformResult = computed(
  () => `当前：${platformLabel(ui.deployPlatform)}${ui.deployPlatform === 'workers' ? ' Workers' : ' / Node'}`,
);

// 自动检测（mock：600ms 转圈后确认当前平台）
function detectPlatform() {
  setDeployPlatform(ui.deployPlatform); // 持久化当前值
  toast(`检测到部署平台：${platformLabel(ui.deployPlatform)}`, 'success');
}

// 演示端可在两平台间切换（真实端由后端注入，前端不可改）
function switchPlatform(p: DeployPlatform) {
  if (p === ui.deployPlatform) return;
  setDeployPlatform(p);
  toast(`已切换演示平台为 ${platformLabel(p)}`, 'info');
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-base font-semibold">通用偏好</h3>
      <p class="mt-1 text-sm text-muted-foreground">界面与展示相关的偏好设置。</p>
    </div>

    <div class="space-y-1.5">
      <Label>默认货币显示</Label>
      <Input v-model="settingsState.currency" class="w-64" @blur="persistCurrency" />
    </div>

    <!-- 隐藏分页 -->
    <div class="flex items-center gap-4 rounded-lg border border-border p-4">
      <Switch v-model="hidePagination" />
      <div>
        <p class="text-sm font-medium">隐藏分页</p>
        <p class="text-xs text-muted-foreground">开启后主页站点表格不分页，一次平铺全部站点。</p>
      </div>
    </div>

    <!-- 部署平台检测 + 过滤 -->
    <div class="space-y-3 rounded-lg border border-border p-4">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="text-sm font-medium">部署平台</p>
          <p class="mt-0.5 text-xs text-muted-foreground">{{ platformResult }}</p>
        </div>
        <Button variant="outline" size="sm" class="shrink-0 gap-1.5" @click="detectPlatform">
          <RefreshCw :size="15" />
          自动检测
        </Button>
      </div>
      <!-- 演示端平台切换（真实端由后端决定，此处便于预览两平台专属功能） -->
      <div class="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        <RotateCw :size="14" class="shrink-0" />
        <span class="shrink-0">演示平台</span>
        <div class="ml-auto inline-flex overflow-hidden rounded-md border border-border">
          <button
            class="px-3 py-1"
            :class="ui.deployPlatform === 'node' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'"
            @click="switchPlatform('node')"
          >Docker / Node</button>
          <button
            class="border-l border-border px-3 py-1"
            :class="ui.deployPlatform === 'workers' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'"
            @click="switchPlatform('workers')"
          >Cloudflare</button>
        </div>
      </div>
      <p class="text-xs text-muted-foreground">
        侧栏会按当前平台自动隐藏另一平台的专属功能（Cloudflare 隐藏「爬虫 · Docker」「代理」；Docker 隐藏「爬虫 · Cloudflare」）。
      </p>
    </div>
  </div>
</template>
