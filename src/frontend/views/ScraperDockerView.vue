<script setup lang="ts">
// 爬虫 · Docker（Phase H）：Node/Docker 部署下的全局爬取设置。
// 定时=node-cron（间隔可热改、即时生效）；支持 http/https/socks5 代理；并发/超时/重试自由配置，无平台硬限。
// 唯一事实来源：scraperState.dk；后端并发/超时/重试对接见 [[scraper-backend-concurrency-todo]]。
import { onMounted, ref } from 'vue';
import { CheckCircle2, Network, ArrowRight } from 'lucide-vue-next';
import AppHeader from '@/components/AppHeader.vue';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { scraperState, loadScraperSettings, saveDk } from '@/stores/scraper';
import { showView } from '@/stores/ui';
import { toast } from '@/composables/useToast';
import { ApiError } from '@/api';
import { useI18n } from 'vue-i18n';

const { t } = useI18n({ useScope: 'global' });

const dk = scraperState.dk;
const busy = ref(false);

onMounted(() => {
  loadScraperSettings().catch((e) => {
    toast(e instanceof ApiError ? e.message : t('scraper.loadFailed'), 'error');
  });
});

async function onSave() {
  busy.value = true;
  try {
    await saveDk();
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
    <AppHeader :title="t('scraper.docker.title')">
      <template #actions>
        <span class="inline-flex items-center rounded-md bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-600 dark:text-sky-400">
          Node / Docker
        </span>
      </template>
    </AppHeader>

    <div class="mx-auto max-w-[900px] space-y-6 p-4 sm:p-6">
      <!-- 平台提示：无硬限制 -->
      <div class="flex items-start gap-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm">
        <CheckCircle2 :size="18" class="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div class="min-w-0">
          <p class="font-medium text-emerald-700 dark:text-emerald-300">{{ t('scraper.docker.platformTitle') }}</p>
          <p class="mt-1 text-muted-foreground" v-html="t('scraper.docker.platformDesc')"></p>
        </div>
      </div>

      <div>
        <h3 class="text-base font-semibold">{{ t('scraper.settingsTitle') }}</h3>
        <p class="mt-1 text-sm text-muted-foreground">{{ t('scraper.settingsDesc') }}</p>
      </div>

      <!-- 定时机制：node-cron，间隔可编辑 -->
      <div class="space-y-3 rounded-lg border border-border p-4">
        <div class="flex items-center gap-4">
          <Switch v-model="dk.autoOn" />
          <div>
            <p class="text-sm font-medium">{{ t('scraper.autoScrape') }}</p>
            <p class="text-xs text-muted-foreground">{{ t('scraper.docker.autoScrapeDesc') }}</p>
          </div>
        </div>

        <div class="space-y-1.5">
          <Label>{{ t('scraper.docker.interval') }}</Label>
          <div class="flex items-center gap-2">
            <Input v-model.number="dk.interval" type="number" min="1" class="w-28" />
            <Select v-model="dk.intervalUnit">
              <SelectTrigger class="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="min">{{ t('scraper.docker.unitMin') }}</SelectItem>
                <SelectItem value="hour">{{ t('scraper.docker.unitHour') }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p class="text-xs text-muted-foreground">{{ t('scraper.docker.intervalHint') }}</p>
        </div>
      </div>

      <!-- 代理支持：支持 -->
      <div class="flex items-start gap-3 rounded-lg border border-border p-4">
        <Network :size="18" class="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium">{{ t('scraper.docker.proxyTitle') }}</p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            {{ t('scraper.docker.proxyDesc') }}
          </p>
        </div>
        <Button variant="outline" size="sm" class="shrink-0 self-center gap-1" @click="showView('proxy')">
          {{ t('scraper.docker.goProxy') }}
          <ArrowRight :size="14" />
        </Button>
      </div>

      <!-- 并发/超时/重试：自由配置 -->
      <div class="space-y-1.5">
        <Label>{{ t('scraper.concurrency') }}</Label>
        <Input v-model.number="dk.concurrency" type="number" min="1" max="50" class="w-28" />
        <p class="text-xs text-muted-foreground">{{ t('scraper.docker.concurrencyHint') }}</p>
      </div>

      <div class="space-y-1.5">
        <Label>{{ t('scraper.timeoutSec') }}</Label>
        <Input v-model.number="dk.timeout" type="number" min="1" class="w-28" />
        <p class="text-xs text-muted-foreground">{{ t('scraper.docker.timeoutHint') }}</p>
      </div>

      <div class="space-y-1.5">
        <Label>{{ t('scraper.docker.retry') }}</Label>
        <Input v-model.number="dk.retry" type="number" min="0" max="5" class="w-28" />
        <p class="text-xs text-muted-foreground">{{ t('scraper.docker.retryHint') }}</p>
      </div>

      <div class="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button :disabled="busy" @click="onSave">{{ busy ? t('common.saving') : t('scraper.saveSettings') }}</Button>
      </div>
    </div>
  </div>
</template>
