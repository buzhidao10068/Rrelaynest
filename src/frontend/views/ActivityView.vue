<script setup lang="ts">
// 测活页（Phase G）：站点连通性检测（测试连接=响应耗时 / 渠道测试=发一句测活词看模型能否回复，均为 mock）
// + 分组视图 + 测活词池（新增/编辑/启停/删除/配置站点，全局默认词选择）。
// 唯一事实来源：probeState.words / probeState.globalText / sites[].probeText。
import { ref, reactive, computed, onMounted } from 'vue';
import { Wifi, MessageSquare, LayoutGrid, Plus, Pencil, Trash2, ChevronRight, ChevronDown } from 'lucide-vue-next';
import AppHeader from '@/components/AppHeader.vue';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/api';
import { sitesState, allGroups, loadSites } from '@/stores/sites';
import {
  probeState, setGlobalProbe, setGlobalEnabled, toggleProbe, deleteProbe,
  probeSiteCount, loadProbeWords, type ProbeWord,
} from '@/stores/probes';
import { running, runConnectivityCheck, runModelCheck } from '@/composables/useActivityCheck';
import { toast } from '@/composables/useToast';
import ProbeModal from '@/components/probe/ProbeModal.vue';
import ProbeAssignModal from '@/components/probe/ProbeAssignModal.vue';
import SiteCheckRow from '@/components/site/SiteCheckRow.vue';

// ---- 分组视图 ----
const groupMode = ref(false);
const collapsed = reactive<Record<string, boolean>>({});
function toggleGroup(g: string) {
  collapsed[g] = !collapsed[g];
}
const groupedRows = computed(() =>
  allGroups.value
    .map((g) => ({ name: g, sites: sitesState.list.filter((s) => (s.group || '未分组') === g) }))
    .filter((g) => g.sites.length),
);

// ---- 弹窗状态 ----
const modalOpen = ref(false);
const modalEditing = ref<number | null>(null);
const assignOpen = ref(false);
const assignProbeText = ref<string | null>(null);

// 全局默认词下拉：只列启用中的词条。空列表兜底 hi。
const enabledWords = computed(() => probeState.words.filter((w) => w.enabled));
const globalSel = computed({
  get: () => probeState.globalText,
  set: (v: string) => {
    setGlobalProbe(v)
      .then(() => toast(`全局默认词已设为「${probeState.globalText}」`, 'success'))
      .catch((e) => toast(errMsg(e, '设置全局默认词失败'), 'error'));
  },
});
// 全局默认词开关：关闭后未单独绑词的站点渠道测试跳过（测试连接不受影响）。
const globalOn = computed({
  get: () => probeState.globalEnabled,
  set: (on: boolean) => {
    setGlobalEnabled(on)
      .then(() => toast(on ? '全局默认词已开启' : '全局默认词已关闭，未绑定词的站点将跳过渠道测试', on ? 'success' : 'info'))
      .catch((e) => toast(errMsg(e, '切换全局开关失败'), 'error'));
  },
});

function errMsg(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

// ---- 测活词池操作 ----
function onCreateProbe() {
  modalEditing.value = null;
  modalOpen.value = true;
}
function onEditProbe(w: ProbeWord) {
  modalEditing.value = w.id;
  modalOpen.value = true;
}
async function onToggleProbe(w: ProbeWord) {
  try {
    const en = await toggleProbe(w.id);
    if (en === null) return;
    toast(`「${w.text}」${en ? '已启用' : '已停用'}`, en ? 'success' : 'info');
  } catch (e) {
    toast(errMsg(e, '切换启用状态失败'), 'error');
  }
}
async function onDeleteProbe(w: ProbeWord) {
  if (!confirm(`确定删除测活词「${w.text}」？绑定它的站点将回落到全局默认词。`)) return;
  try {
    if (await deleteProbe(w.id)) toast(`已删除「${w.text}」`, 'success');
  } catch (e) {
    toast(errMsg(e, '删除失败'), 'error');
  }
}
function onAssignProbe(w: ProbeWord) {
  assignProbeText.value = w.text;
  assignOpen.value = true;
}

onMounted(async () => {
  try {
    await Promise.all([loadSites(), loadProbeWords()]);
  } catch (e) {
    toast(errMsg(e, '加载测活数据失败'), 'error');
  }
});
</script>

<template>
  <div class="min-h-screen bg-background">
    <AppHeader title="测活" />

    <div class="mx-auto max-w-[900px] space-y-6 p-4 sm:p-6">
      <!-- 标题 + 检测按钮 -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 class="text-base font-semibold">站点连通性检测</h3>
          <p class="mt-1 text-sm text-muted-foreground">
            测试连接=后端量各站 {base}/api/pricing 响应耗时；渠道测试=对该站每个上游模型发一句测活词，逐个判可用。均由后端经站点绑定代理发起（不受浏览器 CORS 限制）。
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            :variant="groupMode ? 'default' : 'outline'"
            title="按分组归类"
            @click="groupMode = !groupMode"
          >
            <LayoutGrid :size="16" />
            分组
          </Button>
          <Button variant="outline" :disabled="running" title="探测各站响应耗时" @click="runConnectivityCheck()">
            <Wifi :size="16" />
            测试连接
          </Button>
          <Button :disabled="running" title="发一句测活词看模型能否正常回复" @click="runModelCheck()">
            <MessageSquare :size="16" />
            渠道测试
          </Button>
        </div>
      </div>

      <!-- 测活词池 -->
      <div class="space-y-3 rounded-lg border border-border bg-card p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-sm font-medium">测活词</p>
            <p class="mt-0.5 text-xs text-muted-foreground">
              渠道测试时发给模型的话，模型正常回复即判为存活。为站点单独绑定某词，或选一条作全局默认；未绑定的站点走全局。
            </p>
          </div>
          <Button size="sm" class="shrink-0" @click="onCreateProbe">
            <Plus :size="15" />
            新增测活词
          </Button>
        </div>

        <!-- 全局默认词 -->
        <div class="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">全局默认词</p>
            <p class="text-xs text-muted-foreground">
              未单独绑定测活词的站点默认用这条。关闭后这些站点将跳过渠道测试（测试连接不受影响）。
            </p>
          </div>
          <Switch v-model="globalOn" />
          <Select v-model="globalSel" :disabled="!globalOn">
            <SelectTrigger class="w-full shrink-0 sm:w-56" :class="!globalOn && 'opacity-50'">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem v-for="w in enabledWords" :key="w.text" :value="w.text">{{ w.text }}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <!-- 词条卡片列表 -->
        <div class="space-y-2">
          <div
            v-if="!probeState.words.length"
            class="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground"
          >
            暂无测活词，点击右上角「新增测活词」添加。
          </div>
          <div
            v-for="w in probeState.words"
            :key="w.text"
            class="rounded-lg border border-border bg-background p-3"
          >
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="flex min-w-0 flex-wrap items-center gap-2" :class="w.enabled ? '' : 'opacity-60'">
                <span class="truncate font-mono text-sm font-semibold">{{ w.text }}</span>
                <span
                  v-if="w.enabled"
                  class="inline-flex items-center rounded-md bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400"
                >● 已启用</span>
                <span
                  v-else
                  class="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                >○ 已停用</span>
                <span
                  v-if="w.text === probeState.globalText"
                  class="inline-flex items-center rounded-md bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-600 dark:text-blue-400"
                >全局</span>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <Switch
                  :model-value="w.enabled"
                  :title="w.enabled ? '停用此测活词' : '启用此测活词'"
                  @update:model-value="onToggleProbe(w)"
                />
              </div>
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <Button variant="outline" size="sm" @click="onEditProbe(w)">
                <Pencil :size="14" />
                编辑
              </Button>
              <Button variant="outline" size="sm" title="配置哪些站点使用此测活词" @click="onAssignProbe(w)">
                <LayoutGrid :size="14" />
                配置站点
                <span class="ml-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold">
                  {{ probeSiteCount(w.text) }}
                </span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
                @click="onDeleteProbe(w)"
              >
                <Trash2 :size="14" />
                删除
              </Button>
            </div>
          </div>
        </div>
      </div>

      <!-- 站点检测列表 -->
      <div class="rounded-lg border border-border bg-card">
        <div v-if="!sitesState.list.length" class="p-8 text-center text-sm text-muted-foreground">
          暂无站点
        </div>

        <!-- 平铺 -->
        <div v-else-if="!groupMode" class="divide-y divide-border">
          <SiteCheckRow
            v-for="s in sitesState.list"
            :key="s.name"
            :site="s"
          />
        </div>

        <!-- 分组 -->
        <div v-else>
          <template v-for="g in groupedRows" :key="g.name">
            <div
              class="flex cursor-pointer select-none items-center gap-2 bg-muted/40 px-4 py-2 hover:bg-muted/70"
              @click="toggleGroup(g.name)"
            >
              <ChevronRight v-if="collapsed[g.name]" :size="16" class="text-muted-foreground" />
              <ChevronDown v-else :size="16" class="text-muted-foreground" />
              <span class="text-sm font-semibold">{{ g.name }}</span>
              <span class="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{{ g.sites.length }}</span>
            </div>
            <div v-if="!collapsed[g.name]" class="divide-y divide-border">
              <SiteCheckRow
                v-for="s in g.sites"
                :key="s.name"
                :site="s"
              />
            </div>
          </template>
        </div>
      </div>
    </div>

    <ProbeModal :open="modalOpen" :editing="modalEditing" @close="modalOpen = false" />
    <ProbeAssignModal :open="assignOpen" :probe-text="assignProbeText" @close="assignOpen = false" />
  </div>
</template>
