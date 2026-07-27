<script setup lang="ts">
// 代理页「配置哪些站点使用此代理」弹窗（Phase F）：
// 默认平铺 / 分组两视图；勾选态本地暂存（切视图不丢），保存时统一落 sites[].proxy。
import { ref, computed, watch } from 'vue';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { sitesState, allGroups, type Site } from '@/stores/sites';
import { assignSitesToProxy } from '@/stores/proxies';
import { toast } from '@/composables/useToast';

const props = defineProps<{ open: boolean; proxyName: string | null }>();
const emit = defineEmits<{ (e: 'close'): void }>();

type AssignView = 'default' | 'group';
const view = ref<AssignView>('default');
// 本次会话的勾选态（siteName → checked）。打开时按 s.proxy===proxyName 初始化。
const checks = ref<Record<string, boolean>>({});

watch(
  () => [props.open, props.proxyName] as const,
  ([open, name]) => {
    if (!open || !name) return;
    view.value = 'default';
    const init: Record<string, boolean> = {};
    sitesState.list.forEach((s) => { init[s.name] = s.proxy === name; });
    checks.value = init;
  },
  { immediate: true },
);

const title = computed(() => `配置使用「${props.proxyName ?? ''}」的站点`);
const checkedCount = computed(() => Object.values(checks.value).filter(Boolean).length);

// 分组视图：按 allGroups 归类
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
// 绑到别的代理时的当前提示
function otherProxy(s: Site): string {
  return s.proxy && s.proxy !== props.proxyName ? s.proxy : '';
}

function onSave() {
  if (!props.proxyName) { emit('close'); return; }
  const checkedNames = new Set(
    Object.entries(checks.value).filter(([, v]) => v).map(([k]) => k),
  );
  const cnt = assignSitesToProxy(props.proxyName, checkedNames);
  toast(`「${props.proxyName}」已配置 ${cnt} 个站点`, 'success');
  emit('close');
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent class="flex max-h-[calc(100vh-2rem)] max-w-[520px] flex-col">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>勾选的站点将经此代理出网；取消勾选则回落跟随全局。</DialogDescription>
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
            :key="s.name"
            class="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-accent"
            @click="toggleSite(s.name)"
          >
            <Checkbox :model-value="!!checks[s.name]" class="pointer-events-none" />
            <span class="min-w-0 flex-1 truncate text-sm">{{ s.name }}</span>
            <span v-if="otherProxy(s)" class="shrink-0 text-xs text-muted-foreground">
              当前：{{ otherProxy(s) }}
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
              :key="s.name"
              class="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-accent"
              @click="toggleSite(s.name)"
            >
              <Checkbox :model-value="!!checks[s.name]" class="pointer-events-none" />
              <span class="min-w-0 flex-1 truncate text-sm">{{ s.name }}</span>
              <span v-if="otherProxy(s)" class="shrink-0 text-xs text-muted-foreground">
                当前：{{ otherProxy(s) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" @click="emit('close')">取消</Button>
        <Button @click="onSave">保存</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
