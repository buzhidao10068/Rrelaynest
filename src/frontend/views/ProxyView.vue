<script setup lang="ts">
// 代理页（块8 已接线）：平台提示（Workers 灰掉）+ 代理池卡片 + 全局代理选择
// + 新增/编辑弹窗 + 配置站点弹窗（过渡：仍绑 mock 站点）。
// 事实来源：后端 /api/proxies + settings.global_proxy_id（proxyState 是其前端缓存）。
import { ref, computed, onMounted } from 'vue';
import { Plus, Pencil, LayoutGrid, Trash2, AlertTriangle } from 'lucide-vue-next';
import AppHeader from '@/components/AppHeader.vue';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  proxyState, PROXY_TYPE_STYLE, loadProxies, setGlobalProxy, toggleProxyEnabled,
  deleteProxy, proxySiteCount, findProxy, type Proxy,
} from '@/stores/proxies';
import { ui } from '@/stores/ui';
import { toast } from '@/composables/useToast';
import ProxyModal from '@/components/proxy/ProxyModal.vue';
import SiteAssignModal from '@/components/proxy/SiteAssignModal.vue';

const isWorkers = computed(() => ui.deployPlatform === 'workers');

// 弹窗状态
const modalOpen = ref(false);
const modalEditing = ref<Proxy | null>(null);
const assignOpen = ref(false);
const assignProxy = ref<Proxy | null>(null);

// 进页拉取。失败 toast，不阻塞渲染（列表为空 → 显示空态）。
onMounted(async () => {
  try {
    await loadProxies();
  } catch (e) {
    toast(e instanceof Error ? e.message : '加载代理失败', 'error');
  }
});

// 全局代理下拉：Reka Select 不接受空字符串 value，用哨兵表示直连；value 用 id 字符串。
const DIRECT = '__direct__';
const globalSel = computed({
  get: () => (proxyState.globalProxyId == null ? DIRECT : String(proxyState.globalProxyId)),
  set: async (v: string) => {
    const id = v === DIRECT ? null : Number(v);
    try {
      await setGlobalProxy(id);
      const p = id == null ? undefined : findProxy(id);
      if (id == null) toast('全局设为直连；未单独绑定代理的站点将直连', 'info');
      else if (p && !p.enabled) toast(`「${p.name}」已设为全局，但它当前被停用`, 'info');
      else if (p) toast(`全局代理已设为「${p.name}」`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : '设置全局代理失败', 'error');
    }
  },
});

function typeBadgeClass(t: Proxy['type']): string {
  return PROXY_TYPE_STYLE[t];
}
function authLabel(p: Proxy): string {
  return p.user ? `需认证 · ${p.user}` : '无认证';
}

function onCreate() {
  modalEditing.value = null;
  modalOpen.value = true;
}
function onEdit(p: Proxy) {
  modalEditing.value = p;
  modalOpen.value = true;
}
async function onToggle(p: Proxy) {
  try {
    const en = await toggleProxyEnabled(p.id);
    toast(`「${p.name}」${en ? '已启用' : '已停用'}`, en ? 'success' : 'info');
  } catch (e) {
    toast(e instanceof Error ? e.message : '操作失败', 'error');
  }
}
async function onDelete(p: Proxy) {
  if (!confirm(`确定删除代理「${p.name}」？绑定它的站点将回落跟随全局。`)) return;
  try {
    await deleteProxy(p.id);
    toast(`已删除「${p.name}」`, 'success');
  } catch (e) {
    toast(e instanceof Error ? e.message : '删除失败', 'error');
  }
}
function onAssign(p: Proxy) {
  assignProxy.value = p;
  assignOpen.value = true;
}
</script>

<template>
  <div class="min-h-screen bg-background">
    <AppHeader title="代理 · Docker" />

    <div class="mx-auto max-w-[900px] space-y-6 p-4 sm:p-6">
      <!-- 平台提示条：仅 Workers 部署显示（代理不可用，强制直连） -->
      <div
        v-if="isWorkers"
        class="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
      >
        <AlertTriangle :size="18" class="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div class="min-w-0">
          <p class="font-medium text-amber-700 dark:text-amber-300">当前部署为 Cloudflare Workers，代理功能不可用</p>
          <p class="mt-1 text-muted-foreground">
            Workers 运行时无法连接自建代理，所有站点将强制直连。代理配置仅在 Node/Docker 部署下生效。你仍可在此查看/编辑配置，但不会实际生效。
          </p>
        </div>
      </div>

      <!-- 标题 + 新增 -->
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 class="text-base font-semibold">代理池</h3>
          <p class="mt-1 text-sm text-muted-foreground">
            管理多个出站代理。为站点单独绑定代理，或在下方选一个作全局出网；未绑定的站点走全局，全局设为直连则不经代理。
          </p>
        </div>
        <Button class="shrink-0" @click="onCreate">
          <Plus :size="16" />
          新增代理
        </Button>
      </div>

      <!-- 全局代理 -->
      <div class="flex flex-wrap items-center gap-4 rounded-lg border border-border p-4">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium">全局代理</p>
          <p class="text-xs text-muted-foreground">未单独绑定代理的站点默认走这里；选「直连」则不经代理。</p>
        </div>
        <Select v-model="globalSel">
          <SelectTrigger class="w-full shrink-0 sm:w-64">
            <SelectValue placeholder="直连（不使用代理）" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="DIRECT">直连（不使用代理）</SelectItem>
            <SelectItem v-for="p in proxyState.list" :key="p.id" :value="String(p.id)">
              {{ p.name }} · {{ p.type.toUpperCase() }} {{ p.host }}:{{ p.port }}{{ p.enabled ? '' : '（已停用）' }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <!-- 代理卡片列表 -->
      <div class="space-y-3">
        <div
          v-if="!proxyState.list.length"
          class="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground"
        >
          暂无代理，点击右上角「新增代理」添加。
        </div>

        <div
          v-for="p in proxyState.list"
          :key="p.id"
          class="rounded-lg border border-border bg-card p-4"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0" :class="p.enabled ? '' : 'opacity-60'">
              <div class="flex flex-wrap items-center gap-2">
                <span class="truncate text-sm font-semibold">{{ p.name }}</span>
                <span
                  class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
                  :class="typeBadgeClass(p.type)"
                >{{ p.type.toUpperCase() }}</span>
                <span
                  v-if="p.enabled"
                  class="inline-flex items-center rounded-md bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400"
                >● 已启用</span>
                <span
                  v-else
                  class="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                >○ 已停用</span>
                <span
                  v-if="p.id === proxyState.globalProxyId"
                  class="inline-flex items-center rounded-md bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400"
                >全局</span>
              </div>
              <p class="mt-1 truncate font-mono text-xs text-muted-foreground">{{ p.host }}:{{ p.port }}</p>
              <p class="mt-0.5 text-xs text-muted-foreground">{{ authLabel(p) }}</p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Switch
                :model-value="p.enabled"
                :title="p.enabled ? '停用此代理' : '启用此代理'"
                @update:model-value="onToggle(p)"
              />
            </div>
          </div>

          <div class="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button variant="outline" size="sm" @click="onEdit(p)">
              <Pencil :size="14" />
              编辑
            </Button>
            <Button variant="outline" size="sm" title="配置哪些站点使用此代理" @click="onAssign(p)">
              <LayoutGrid :size="14" />
              配置站点
              <span class="ml-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
                {{ proxySiteCount(p.id) }}
              </span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
              @click="onDelete(p)"
            >
              <Trash2 :size="14" />
              删除
            </Button>
          </div>
        </div>
      </div>
    </div>

    <ProxyModal :open="modalOpen" :editing="modalEditing" @close="modalOpen = false" />
    <SiteAssignModal :open="assignOpen" :proxy="assignProxy" @close="assignOpen = false" />
  </div>
</template>
