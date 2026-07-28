<script setup lang="ts">
// 关于页（Phase K → 块8 接后端 /api/update/check）：版本信息卡 + 检查更新 + 更新结果面板 + 自动检查开关。
// 版本比对/升级步骤均由后端权威给出（后端知道自己的 appVersion/platform）；前端只展示。
// 不做应用内自更新，只通知 + 给对应平台升级命令。
import { computed, onMounted } from 'vue';
import { Info, RefreshCw, ExternalLink, Check, AlertTriangle } from 'lucide-vue-next';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  aboutState, RELEASES_URL,
  hasNewVersion, checkForUpdate, loadAbout, setAutoUpdate,
} from '@/stores/about';
import { ApiError } from '@/api';
import { toast } from '@/composables/useToast';

// 当前版本（后端注入，载入前为空）
const currentVer = computed(() => aboutState.current || '—');

// 升级步骤按平台由后端给（含 wrangler 即 Workers）；结果面板前展示用 ui 平台兜底不再需要。
const isWorkers = computed(() => aboutState.upgradeSteps.some((s) => s.includes('wrangler')));

// 更新结果三态：无检查结果 / 已是最新 / 有新版
const latest = computed(() => aboutState.latest);
const isLatest = computed(() => aboutState.current !== '' && latest.value != null && !hasNewVersion());
const hasNew = computed(() => hasNewVersion());

// 更新日志：body 按行去前缀 → 数组
const changelog = computed(() =>
  String(latest.value?.body || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[-*]\s*/, '')),
);

// 升级步骤：后端权威（按平台）；一行一条命令拼成多行文本供复制。
const upgradeCmds = computed(() => aboutState.upgradeSteps.join('\n'));
const upgradeNote = computed(() =>
  isWorkers.value
    ? 'Workers 需重新构建并部署；若已接 GitHub 自动部署，推送 tag 后会自动发布。'
    : '拉取最新镜像并重建容器；数据卷（SQLite/挂载目录）保留不受影响。',
);
const relTagUrl = computed(() => latest.value?.html_url || RELEASES_URL);

const autoOn = computed({
  get: () => aboutState.autoUpdate,
  set: (v: boolean) => {
    setAutoUpdate(v)
      .then(() => toast(v ? '已开启自动检查更新' : '已关闭自动检查更新', 'info'))
      .catch((e) => toast(e instanceof ApiError ? e.message : '切换失败', 'error'));
  },
});

async function onCheck() {
  try {
    const res = await checkForUpdate();
    if (res.error) toast(`检查更新失败：${res.error}`, 'error');
    else if (res.has_update) toast(`发现新版本 ${res.latest?.tag_name}`, 'info');
    else toast('当前已是最新版本', 'success');
  } catch (e) {
    toast(e instanceof ApiError ? e.message : '检查更新失败', 'error');
  }
}

// 进入关于页：载入自动检查开关；开启则静默查一次（有新版直接展示面板，不弹 toast）。
onMounted(() => {
  loadAbout().catch((e) => toast(e instanceof ApiError ? e.message : '载入版本信息失败', 'error'));
});
</script>

<template>
  <div class="min-h-screen bg-background">
    <header
      class="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60"
    >
      <SidebarTrigger class="-ml-1" />
      <Separator orientation="vertical" class="mr-1 h-4" />
      <Info :size="18" />
      <h1 class="text-base font-semibold">关于</h1>
    </header>

    <div class="mx-auto max-w-[720px] space-y-6 p-4 sm:p-6">
      <div>
        <h3 class="text-base font-semibold">关于 Rrelaynest</h3>
        <p class="mt-1 text-sm text-muted-foreground">中转站余额与签到管理面板。</p>
      </div>

      <!-- 版本信息卡 -->
      <div class="rounded-lg border border-border p-4 text-sm">
        <div class="flex items-center justify-between py-1">
          <span class="text-muted-foreground">应用</span>
          <span class="font-medium">Rrelaynest</span>
        </div>
        <div class="flex items-center justify-between gap-3 py-1">
          <span class="text-muted-foreground">版本</span>
          <span class="flex items-center gap-2">
            <span class="font-medium">{{ currentVer }}</span>
            <span
              v-if="hasNew"
              class="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary"
            >有新版 {{ latest?.tag_name }}</span>
          </span>
        </div>
        <div class="flex items-center justify-between py-1">
          <span class="text-muted-foreground">部署</span>
          <span class="font-medium">Cloudflare Workers / Docker</span>
        </div>
        <div class="flex items-center justify-between gap-3 py-1">
          <span class="text-muted-foreground">推荐规模</span>
          <span class="flex items-center gap-2">
            <span class="font-medium">≤ 20 用户</span>
            <span class="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">默认存储</span>
          </span>
        </div>
        <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
          默认使用 SQLite/D1（单文件锁、调度串行、鉴权每请求查库），适合
          <b>约 20 个用户</b>、每人数十~数百站点的小规模自用。更大规模请升级到 libSQL/Turso 或
          Postgres（业务层已隔离，仅换存储适配）。
        </p>

        <div class="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3">
          <Button variant="outline" :disabled="aboutState.checking" @click="onCheck">
            <RefreshCw :size="16" :class="aboutState.checking ? 'animate-spin' : ''" />
            检查更新
          </Button>
          <a
            :href="RELEASES_URL"
            target="_blank"
            rel="noopener"
            class="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ExternalLink :size="15" />
            发布记录
          </a>
        </div>
      </div>

      <!-- 检查失败面板：网络/GitHub 限流等 -->
      <div
        v-if="aboutState.error"
        class="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
      >
        <AlertTriangle :size="18" class="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div class="min-w-0">
          <p class="font-medium text-amber-700 dark:text-amber-300">检查更新失败</p>
          <p class="mt-1 text-muted-foreground">{{ aboutState.error }}</p>
        </div>
      </div>

      <!-- 更新结果面板：已是最新 / 有新版 -->
      <div v-if="!aboutState.error && isLatest" class="rounded-lg border border-border p-4">
        <div class="flex items-center gap-2 text-sm">
          <Check :size="16" class="text-emerald-600 dark:text-emerald-400" />
          <span>当前已是最新版本 {{ currentVer }}</span>
        </div>
      </div>

      <div v-else-if="hasNew && latest" class="rounded-lg border border-border p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1 rounded-md bg-primary/15 px-2 py-0.5 text-sm font-medium text-primary">发现新版本</span>
            <span class="text-sm font-semibold">{{ currentVer }} → {{ latest.tag_name }}</span>
          </div>
          <span class="text-xs text-muted-foreground">{{ latest.published_at }}</span>
        </div>
        <ul
          v-if="changelog.length"
          class="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground"
        >
          <li v-for="(line, i) in changelog" :key="i">{{ line }}</li>
        </ul>

        <!-- 升级步骤：按平台 -->
        <div class="mt-4 border-t border-border pt-3">
          <p class="text-sm font-medium">
            升级步骤 · {{ isWorkers ? 'Cloudflare Workers' : 'Docker / Node' }}
          </p>
          <p class="mt-0.5 text-xs text-muted-foreground">应用无法自更新；请在部署环境执行以下步骤。</p>
          <pre class="mt-2 overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs leading-relaxed">{{ upgradeCmds }}</pre>
          <p class="mt-2 text-xs text-muted-foreground">{{ upgradeNote }}</p>
          <a
            :href="relTagUrl"
            target="_blank"
            rel="noopener"
            class="mt-2 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            查看该版本发布说明
            <ExternalLink :size="13" />
          </a>
        </div>
      </div>

      <!-- 自动检查开关 -->
      <div class="flex items-center gap-4 rounded-lg border border-border p-4">
        <Switch v-model="autoOn" />
        <div>
          <p class="text-sm font-medium">自动检查更新</p>
          <p class="text-xs text-muted-foreground">
            定期向 GitHub Releases 查询新版本；发现新版在此页提示。不会自动下载或替换，升级仍需你手动执行。
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
