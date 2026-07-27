<script setup lang="ts">
// 测活页（Phase G）：站点连通性检测（测试连接=响应耗时 / 渠道测试=发一句测活词看模型能否回复，均为 mock）
// + 分组视图 + 测活词池（新增/编辑/启停/删除/配置站点，全局默认词选择）。
// 唯一事实来源：probeState.words / probeState.globalText / sites[].probeText。
import { ref, reactive, computed } from 'vue';
import { Wifi, MessageSquare, LayoutGrid, Plus, Pencil, Trash2, ChevronRight, ChevronDown } from 'lucide-vue-next';
import AppHeader from '@/components/AppHeader.vue';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { sitesState, allGroups } from '@/stores/sites';
import {
  probeState, setGlobalProbe, setGlobalEnabled, toggleProbe, deleteProbe, persistProbes,
  probeSiteCount, effectiveProbe, type ProbeWord,
} from '@/stores/probes';
import { toast } from '@/composables/useToast';
import ProbeModal from '@/components/probe/ProbeModal.vue';
import ProbeAssignModal from '@/components/probe/ProbeAssignModal.vue';

// ---- 检测结果（按站名 → 结果）----
type ConnStatus = 'ok' | 'slow' | 'down' | 'checking';
type ModelStatus = 'ok' | 'down' | 'checking' | 'skipped';
const connResults = reactive<Record<string, { status: ConnStatus; ms: number }>>({});
const modelResults = reactive<Record<string, { status: ModelStatus; probe: string }>>({});
const running = ref(false);

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
const modalEditing = ref<string | null>(null);
const assignOpen = ref(false);
const assignProbeText = ref<string | null>(null);

// 全局默认词下拉：只列启用中的词条。空列表兜底 hi。
const enabledWords = computed(() => probeState.words.filter((w) => w.enabled));
const globalSel = computed({
  get: () => probeState.globalText,
  set: (v: string) => {
    setGlobalProbe(v);
    persistProbes();
    toast(`全局默认词已设为「${probeState.globalText}」`, 'success');
  },
});
// 全局默认词开关：关闭后未单独绑词的站点渠道测试跳过（测试连接不受影响）。
const globalOn = computed({
  get: () => probeState.globalEnabled,
  set: (on: boolean) => {
    setGlobalEnabled(on);
    persistProbes();
    toast(on ? '全局默认词已开启' : '全局默认词已关闭，未绑定词的站点将跳过渠道测试', on ? 'success' : 'info');
  },
});

// ---- 检测徽章 ----
function connBadgeClass(st: ConnStatus): string {
  if (st === 'ok') return 'bg-green-500/15 text-green-600 dark:text-green-400';
  if (st === 'slow') return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
  if (st === 'down') return 'bg-red-500/15 text-red-500';
  return 'bg-blue-500/15 text-blue-600 dark:text-blue-400';
}
function connBadgeText(r?: { status: ConnStatus; ms: number }): string {
  if (!r) return '连接 待检';
  if (r.status === 'ok') return `● 正常 ${r.ms}ms`;
  if (r.status === 'slow') return `● 较慢 ${r.ms}ms`;
  if (r.status === 'down') return '● 不可达';
  return '● 连接中…';
}
function modelBadgeClass(st: ModelStatus): string {
  if (st === 'ok') return 'bg-green-500/15 text-green-600 dark:text-green-400';
  if (st === 'down') return 'bg-red-500/15 text-red-500';
  if (st === 'skipped') return 'bg-muted text-muted-foreground';
  return 'bg-blue-500/15 text-blue-600 dark:text-blue-400';
}
function modelBadgeText(r?: { status: ModelStatus; probe: string }): string {
  if (!r) return '渠道 待检';
  const p = r.probe ? ` · ${r.probe}` : '';
  if (r.status === 'ok') return `● 可用${p}`;
  if (r.status === 'down') return `● 不可用${p}`;
  if (r.status === 'skipped') return '○ 未测（无测活词）';
  return '● 测试中…';
}

// ---- 测试连接（mock：逐站串行，模拟往返延迟）----
function runConnectivityCheck() {
  if (running.value || !sitesState.list.length) return;
  running.value = true;
  Object.keys(connResults).forEach((k) => delete connResults[k]);
  const list = sitesState.list;
  let i = 0;
  const step = () => {
    if (i >= list.length) {
      running.value = false;
      const down = list.filter((s) => connResults[s.name]?.status === 'down').length;
      toast(down ? `连接检测完成，${down} 个站点不可达` : '连接检测完成，全部站点可达', down ? 'error' : 'success');
      return;
    }
    const s = list[i];
    connResults[s.name] = { status: 'checking', ms: 0 };
    const delay = 220 + Math.floor(Math.random() * 480);
    setTimeout(() => {
      const roll = Math.random();
      const ms = Math.floor(delay);
      let st: ConnStatus;
      if (!s.hasToken && roll < 0.35) st = 'down';
      else if (roll < 0.12) st = 'down';
      else if (ms > 550) st = 'slow';
      else st = 'ok';
      connResults[s.name] = { status: st, ms };
      i++;
      step();
    }, delay);
  };
  step();
}

// ---- 渠道测试（mock：逐站发一句测活词，判模型是否正常回复）----
function runModelCheck() {
  if (running.value || !sitesState.list.length) return;
  running.value = true;
  Object.keys(modelResults).forEach((k) => delete modelResults[k]);
  const list = sitesState.list;
  let i = 0;
  const step = () => {
    if (i >= list.length) {
      running.value = false;
      const down = list.filter((s) => modelResults[s.name]?.status === 'down').length;
      toast(down ? `渠道测试完成，${down} 个站点模型不可用` : '渠道测试完成，全部站点模型可用', down ? 'error' : 'success');
      return;
    }
    const s = list[i];
    const probe = effectiveProbe(s.probeText);
    // 没生效测活词（未绑词且全局默认词关闭）→ 跳过渠道测试，不计入不可用
    if (!probe) {
      modelResults[s.name] = { status: 'skipped', probe: '' };
      i++;
      step();
      return;
    }
    modelResults[s.name] = { status: 'checking', probe };
    const delay = 260 + Math.floor(Math.random() * 520);
    setTimeout(() => {
      const roll = Math.random();
      let st: ModelStatus;
      if (!s.hasToken) st = 'down';
      else if (roll < 0.15) st = 'down';
      else st = 'ok';
      modelResults[s.name] = { status: st, probe };
      i++;
      step();
    }, delay);
  };
  step();
}

// ---- 测活词池操作 ----
function onCreateProbe() {
  modalEditing.value = null;
  modalOpen.value = true;
}
function onEditProbe(w: ProbeWord) {
  modalEditing.value = w.text;
  modalOpen.value = true;
}
function onToggleProbe(w: ProbeWord) {
  const en = toggleProbe(w.text);
  if (en === null) return;
  toast(`「${w.text}」${en ? '已启用' : '已停用'}`, en ? 'success' : 'info');
}
function onDeleteProbe(w: ProbeWord) {
  if (!confirm(`确定删除测活词「${w.text}」？绑定它的站点将回落到全局默认词。`)) return;
  if (deleteProbe(w.text)) toast(`已删除「${w.text}」`, 'success');
}
function onAssignProbe(w: ProbeWord) {
  assignProbeText.value = w.text;
  assignOpen.value = true;
}
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
            测试连接=探测响应耗时；渠道测试=发一句测活词看模型能否正常回复（演示为 mock 结果）。
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
          <Button variant="outline" :disabled="running" title="探测各站响应耗时" @click="runConnectivityCheck">
            <Wifi :size="16" />
            测试连接
          </Button>
          <Button :disabled="running" title="发一句测活词看模型能否正常回复" @click="runModelCheck">
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
          <div
            v-for="s in sitesState.list"
            :key="s.name"
            class="flex items-center justify-between gap-3 px-4 py-3"
          >
            <div class="min-w-0">
              <p class="truncate text-sm font-medium">{{ s.name }}</p>
              <p class="truncate text-xs text-muted-foreground">{{ s.url }}</p>
            </div>
            <div class="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
              <span
                class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
                :class="connBadgeClass(connResults[s.name]?.status ?? 'checking')"
                v-if="connResults[s.name]"
              >{{ connBadgeText(connResults[s.name]) }}</span>
              <span
                v-else
                class="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
              >连接 待检</span>
              <span
                class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
                :class="modelBadgeClass(modelResults[s.name]?.status ?? 'checking')"
                v-if="modelResults[s.name]"
              >{{ modelBadgeText(modelResults[s.name]) }}</span>
              <span
                v-else
                class="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
              >渠道 待检</span>
            </div>
          </div>
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
              <div
                v-for="s in g.sites"
                :key="s.name"
                class="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium">{{ s.name }}</p>
                  <p class="truncate text-xs text-muted-foreground">{{ s.url }}</p>
                </div>
                <div class="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  <span
                    class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
                    :class="connBadgeClass(connResults[s.name]?.status ?? 'checking')"
                    v-if="connResults[s.name]"
                  >{{ connBadgeText(connResults[s.name]) }}</span>
                  <span
                    v-else
                    class="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                  >连接 待检</span>
                  <span
                    class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
                    :class="modelBadgeClass(modelResults[s.name]?.status ?? 'checking')"
                    v-if="modelResults[s.name]"
                  >{{ modelBadgeText(modelResults[s.name]) }}</span>
                  <span
                    v-else
                    class="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                  >渠道 待检</span>
                </div>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <ProbeModal :open="modalOpen" :editing="modalEditing" @close="modalOpen = false" />
    <ProbeAssignModal :open="assignOpen" :probe-text="assignProbeText" @close="assignOpen = false" />
  </div>
</template>
