<script setup lang="ts">
// 爬虫 · Cloudflare（Phase H）：Workers 部署下的全局爬取设置。
// 定时=Cron Triggers（wrangler.toml，运行时不可热改）；不支持代理（强制直连）；受 subrequest/CPU 硬限。
// 唯一事实来源：scraperState.cf；后端并发/超时对接见 [[scraper-backend-concurrency-todo]]。
import { computed, onMounted, ref } from 'vue';
import { Info, WifiOff, Copy } from 'lucide-vue-next';
import AppHeader from '@/components/AppHeader.vue';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { scraperState, loadScraperSettings, saveCf, cronSnippet } from '@/stores/scraper';
import { ApiError } from '@/api';
import { toast } from '@/composables/useToast';

const cf = scraperState.cf;
const snippet = computed(() => cronSnippet(cf.cron));
const busy = ref(false);

onMounted(() => {
  loadScraperSettings().catch((e) =>
    toast(e instanceof ApiError ? e.message : '加载爬取设置失败', 'error'),
  );
});

async function copySnippet() {
  try {
    await navigator.clipboard.writeText(snippet.value);
    toast('已复制 wrangler.toml 片段', 'success');
  } catch {
    toast('复制失败，请手动选择', 'error');
  }
}

async function onSave() {
  busy.value = true;
  try {
    await saveCf();
    toast('爬取设置已保存', 'success');
  } catch (e) {
    toast(e instanceof ApiError ? e.message : '保存失败', 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen bg-background">
    <AppHeader title="爬虫 · Cloudflare">
      <template #actions>
        <span class="inline-flex items-center rounded-md bg-orange-500/15 px-2 py-0.5 text-xs font-medium text-orange-600 dark:text-orange-400">
          Workers
        </span>
      </template>
    </AppHeader>

    <div class="mx-auto max-w-[900px] space-y-6 p-4 sm:p-6">
      <!-- 平台限制提示 -->
      <div class="flex items-start gap-3 rounded-lg border border-orange-500/40 bg-orange-500/10 p-4 text-sm">
        <Info :size="18" class="mt-0.5 shrink-0 text-orange-600 dark:text-orange-400" />
        <div class="min-w-0">
          <p class="font-medium text-orange-700 dark:text-orange-300">Cloudflare Workers 部署</p>
          <p class="mt-1 text-muted-foreground">
            定时由 <b>Cron Triggers</b> 触发（在 <code class="rounded bg-muted px-1">wrangler.toml</code> 配置，不能在此页运行时修改）；<b>不支持自建代理</b>，所有请求强制直连；受 Workers 的 <b>subrequest / CPU 时间</b>限制，并发不宜过高。
          </p>
        </div>
      </div>

      <div>
        <h3 class="text-base font-semibold">爬取设置</h3>
        <p class="mt-1 text-sm text-muted-foreground">余额爬取的全局行为；单站可在编辑中覆盖。</p>
      </div>

      <!-- 定时机制：Cron Triggers -->
      <div class="space-y-3 rounded-lg border border-border p-4">
        <div class="flex items-center gap-4">
          <Switch v-model="cf.autoOn" />
          <div>
            <p class="text-sm font-medium">启用定时爬取</p>
            <p class="text-xs text-muted-foreground">由 Cloudflare Cron Triggers 按下方表达式周期性爬取。</p>
          </div>
        </div>

        <div class="space-y-1.5">
          <Label>Cron 表达式</Label>
          <Input v-model="cf.cron" class="max-w-[260px] font-mono" />
          <p class="text-xs text-muted-foreground">
            Workers 的 cron 最小粒度 1 分钟。此值不会在运行时热更新，需写入 <code class="rounded bg-muted px-1">wrangler.toml</code> 后重新部署。
          </p>
        </div>

        <!-- wrangler.toml 片段（只读，可复制） -->
        <div class="space-y-1.5">
          <Label>wrangler.toml 片段</Label>
          <div class="relative">
            <pre class="overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs leading-relaxed">{{ snippet }}</pre>
            <Button
              variant="outline"
              size="sm"
              class="absolute right-2 top-2 h-auto gap-1 px-2 py-1 text-xs"
              @click="copySnippet"
            >
              <Copy :size="13" />
              复制
            </Button>
          </div>
        </div>
      </div>

      <!-- 代理支持：不支持（灰掉） -->
      <div class="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-4 opacity-70">
        <WifiOff :size="18" class="mt-0.5 shrink-0 text-muted-foreground" />
        <div class="min-w-0">
          <p class="text-sm font-medium">出站代理 · 不支持</p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            Workers 运行时无法连接自建代理（http/https/socks5 均不可用），所有站点强制直连。代理功能仅 Docker 部署可用。
          </p>
        </div>
      </div>

      <!-- 并发：受平台硬限制 -->
      <div class="space-y-1.5">
        <Label>并发数</Label>
        <Input v-model.number="cf.concurrency" type="number" min="1" max="6" class="w-28" />
        <p class="text-xs text-muted-foreground">
          受 subrequest 上限（免费 50、付费 1000 /次调用）约束，建议 ≤ 6，过高易触及单次调用配额。
        </p>
      </div>

      <div class="space-y-1.5">
        <Label>单站超时（秒）</Label>
        <Input v-model.number="cf.timeout" type="number" min="1" max="30" class="w-28" />
        <p class="text-xs text-muted-foreground">受 Workers CPU 时间限制，单站超时不宜过长（建议 ≤ 30 秒）。</p>
      </div>

      <div class="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button :disabled="busy" @click="onSave">{{ busy ? '保存中…' : '保存设置' }}</Button>
      </div>
    </div>
  </div>
</template>
