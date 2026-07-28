<script setup lang="ts">
// 测活页「配置哪些站点使用此测活词」弹窗（块8 接线后端，按 id）：
// 默认平铺 / 分组两视图；勾选态本地暂存（切视图不丢），保存时逐个 PUT /api/sites/:id { probe_text }。
import { ref, computed, watch } from 'vue';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { sitesState, allGroups, type Site } from '@/stores/sites';
import { assignSitesToProbe } from '@/stores/probes';
import { ApiError } from '@/api';
import { toast } from '@/composables/useToast';

const props = defineProps<{ open: boolean; probeText: string | null }>();
const emit = defineEmits<{ (e: 'close'): void }>();

type AssignView = 'default' | 'group';
const view = ref<AssignView>('default');
// 本次会话的勾选态（siteId → checked）。打开时按 s.probeText===probeText 初始化。
const checks = ref<Record<number, boolean>>({});
const busy = ref(false);

watch(
  () => [props.open, props.probeText] as const,
  ([open, text]) => {
    if (!open || text == null) return;
    view.value = 'default';
    busy.value = false;
    const init: Record<number, boolean> = {};
    sitesState.list.forEach((s) => { init[s.id] = s.probeText === text; });
    checks.value = init;
  },
  { immediate: true },
);

const title = computed(() => `配置使用「${props.probeText ?? ''}」的站点`);
const checkedCount = computed(() => Object.values(checks.value).filter(Boolean).length);

// 分组视图：按 allGroups 归类
const groups = computed(() =>
  allGroups.value.map((g) => ({
    name: g,
    sites: sitesState.list.filter((s) => (s.group || '未分组') === g),
  })),
);

function toggleSite(id: number) {
  checks.value[id] = !checks.value[id];
}
// 组标题：整组已勾则取消全组，否则补勾全组
function toggleGroup(g: string) {
  const rows = sitesState.list.filter((s) => (s.group || '未分组') === g);
  const allOn = rows.length > 0 && rows.every((s) => checks.value[s.id]);
  rows.forEach((s) => { checks.value[s.id] = !allOn; });
}
// 绑到别的测活词时的当前提示
function otherProbe(s: Site): string {
  return s.probeText && s.probeText !== props.probeText ? s.probeText : '';
}

async function onSave() {
  if (props.probeText == null || busy.value) { emit('close'); return; }
  const checkedIds = new Set(
    Object.entries(checks.value).filter(([, v]) => v).map(([k]) => Number(k)),
  );
  busy.value = true;
  try {
    const cnt = await assignSitesToProbe(props.probeText, checkedIds);
    toast(`「${props.probeText}」已配置 ${cnt} 个站点`, 'success');
    emit('close');
  } catch (e) {
    toast(e instanceof ApiError ? e.message : '配置失败', 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent class="flex max-h-[calc(100vh-2rem)] max-w-[520px] flex-col">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>勾选的站点渠道测试将发这条词；取消勾选则回落跟随全局。</DialogDescription>
      </DialogHeader>

      <!-- 视图切换 -->
      <div class="flex gap-2">
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
        <span class="ml-auto self-center text-xs text-muted-foreground">{{ checkedCount }} 站已选</span>
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
            :key="s.id"
            class="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-accent"
            @click="toggleSite(s.id)"
          >
            <Checkbox :model-value="!!checks[s.id]" class="pointer-events-none" />
            <span class="min-w-0 flex-1 truncate text-sm">{{ s.name }}</span>
            <span v-if="otherProbe(s)" class="shrink-0 text-xs text-muted-foreground">
              当前：{{ otherProbe(s) }}
            </span>
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
              :key="s.id"
              class="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-accent"
              @click="toggleSite(s.id)"
            >
              <Checkbox :model-value="!!checks[s.id]" class="pointer-events-none" />
              <span class="min-w-0 flex-1 truncate text-sm">{{ s.name }}</span>
              <span v-if="otherProbe(s)" class="shrink-0 text-xs text-muted-foreground">
                当前：{{ otherProbe(s) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="busy" @click="emit('close')">取消</Button>
        <Button :disabled="busy" @click="onSave">{{ busy ? '保存中…' : '保存' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
