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
import { useI18n } from 'vue-i18n';

const { t } = useI18n({ useScope: 'global' });

const cf = scraperState.cf;
const snippet = computed(() => cronSnippet(cf.cron));
const busy = ref(false);

onMounted(() => {
  loadScraperSettings().catch((e) =>
    toast(e instanceof ApiError ? e.message : t('scraper.loadFailed'), 'error'),
  );
});

async function copySnippet() {
  try {
    await navigator.clipboard.writeText(snippet.value);
    toast(t('scraper.cf.snippetCopied'), 'success');
  } catch {
    toast(t('scraper.cf.copyFailed'), 'error');
  }
}

async function onSave() {
  busy.value = true;
  try {
    await saveCf();
    toast(t('scraper.settingsSaved'), 'success');
  } catch (e) {
    toast(e instanceof ApiError ? e.message : t('scraper.saveFailed'), 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen bg-background">
    <AppHeader :title="t('scraper.cf.title')">
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
          <p class="font-medium text-orange-700 dark:text-orange-300">{{ t('scraper.cf.platformTitle') }}</p>
          <p class="mt-1 text-muted-foreground" v-html="t('scraper.cf.platformDesc')"></p>
        </div>
      </div>

      <div>
        <h3 class="text-base font-semibold">{{ t('scraper.settingsTitle') }}</h3>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('scraper.settingsDesc') }}</p>
      </div>

      <!-- 定时机制：Cron Triggers -->
      <div class="space-y-3 rounded-lg border border-border p-4">
        <div class="flex items-center gap-4">
          <Switch v-model="cf.autoOn" />
          <div>
            <p class="text-sm font-medium">{{ t('scraper.autoScrape') }}</p>
            <p class="text-xs text-muted-foreground">{{ t('scraper.cf.autoScrapeDesc') }}</p>
          </div>
        </div>

        <div class="space-y-1.5">
          <Label>{{ t('scraper.cf.cronExpr') }}</Label>
          <Input v-model="cf.cron" class="max-w-[260px] font-mono" />
          <p class="text-xs text-muted-foreground" v-html="t('scraper.cf.cronHint')"></p>
        </div>

        <!-- wrangler.toml 片段（只读，可复制） -->
        <div class="space-y-1.5">
          <Label>{{ t('scraper.cf.snippetLabel') }}</Label>
          <div class="relative">
            <pre class="overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs leading-relaxed">{{ snippet }}</pre>
            <Button
              variant="outline"
              size="sm"
              class="absolute right-2 top-2 h-auto gap-1 px-2 py-1 text-xs"
              @click="copySnippet"
            >
              <Copy :size="13" />
              {{ t('common.copy') }}
            </Button>
          </div>
        </div>
      </div>

      <!-- 代理支持：不支持（灰掉） -->
      <div class="flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-4 opacity-70">
        <WifiOff :size="18" class="mt-0.5 shrink-0 text-muted-foreground" />
        <div class="min-w-0">
          <p class="text-sm font-medium">{{ t('scraper.cf.proxyTitle') }}</p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            {{ t('scraper.cf.proxyDesc') }}
          </p>
        </div>
      </div>

      <!-- 并发：受平台硬限制 -->
      <div class="space-y-1.5">
        <Label>{{ t('scraper.concurrency') }}</Label>
        <Input v-model.number="cf.concurrency" type="number" min="1" max="6" class="w-28" />
        <p class="text-xs text-muted-foreground">
          {{ t('scraper.cf.concurrencyHint') }}
        </p>
      </div>

      <div class="space-y-1.5">
        <Label>{{ t('scraper.timeoutSec') }}</Label>
        <Input v-model.number="cf.timeout" type="number" min="1" max="30" class="w-28" />
        <p class="text-xs text-muted-foreground">{{ t('scraper.cf.timeoutHint') }}</p>
      </div>

      <div class="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button :disabled="busy" @click="onSave">{{ busy ? t('common.saving') : t('scraper.saveSettings') }}</Button>
      </div>
    </div>
  </div>
</template>
