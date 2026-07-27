<script setup lang="ts">
// 爬虫 · Docker（Phase H）：Node/Docker 部署下的全局爬取设置。
// 定时=node-cron（间隔可热改、即时生效）；支持 http/https/socks5 代理；并发/超时/重试自由配置，无平台硬限。
// 唯一事实来源：scraperState.dk；后端并发/超时/重试对接见 [[scraper-backend-concurrency-todo]]。
import { CheckCircle2, Network, ArrowRight } from 'lucide-vue-next';
import AppHeader from '@/components/AppHeader.vue';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { scraperState, persistDk } from '@/stores/scraper';
import { showView } from '@/stores/ui';
import { toast } from '@/composables/useToast';

const dk = scraperState.dk;

function onSave() {
  persistDk();
  toast('爬取设置已保存', 'success');
}
</script>

<template>
  <div class="min-h-screen bg-background">
    <AppHeader title="爬虫 · Docker">
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
          <p class="font-medium text-emerald-700 dark:text-emerald-300">Docker / Node 部署</p>
          <p class="mt-1 text-muted-foreground">
            定时由 <b>node-cron</b> 驱动，爬取间隔可随时修改、即时生效；<b>支持</b> http/https/socks5 出站代理（在代理页配置）；并发/超时/重试可自由配置，<b>无平台硬限制</b>。
          </p>
        </div>
      </div>

      <div>
        <h3 class="text-base font-semibold">爬取设置</h3>
        <p class="mt-1 text-sm text-muted-foreground">余额爬取的全局行为；单站可在编辑中覆盖。</p>
      </div>

      <!-- 定时机制：node-cron，间隔可编辑 -->
      <div class="space-y-3 rounded-lg border border-border p-4">
        <div class="flex items-center gap-4">
          <Switch v-model="dk.autoOn" />
          <div>
            <p class="text-sm font-medium">启用定时爬取</p>
            <p class="text-xs text-muted-foreground">由 node-cron 按下方间隔周期性爬取所有站点余额。</p>
          </div>
        </div>

        <div class="space-y-1.5">
          <Label>爬取间隔</Label>
          <div class="flex items-center gap-2">
            <Input v-model.number="dk.interval" type="number" min="1" class="w-28" />
            <Select v-model="dk.intervalUnit">
              <SelectTrigger class="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="min">分钟</SelectItem>
                <SelectItem value="hour">小时</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p class="text-xs text-muted-foreground">两次自动爬取之间的最小间隔，修改后即时生效，无需重启。</p>
        </div>
      </div>

      <!-- 代理支持：支持 -->
      <div class="flex items-start gap-3 rounded-lg border border-border p-4">
        <Network :size="18" class="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium">出站代理 · 支持</p>
          <p class="mt-0.5 text-xs text-muted-foreground">
            支持 http/https/socks5。爬取/签到经代理出网，在代理页统一管理。
          </p>
        </div>
        <Button variant="outline" size="sm" class="shrink-0 self-center gap-1" @click="showView('proxy')">
          前往代理页
          <ArrowRight :size="14" />
        </Button>
      </div>

      <!-- 并发/超时/重试：自由配置 -->
      <div class="space-y-1.5">
        <Label>并发数</Label>
        <Input v-model.number="dk.concurrency" type="number" min="1" max="50" class="w-28" />
        <p class="text-xs text-muted-foreground">同时爬取的站点数量；无平台硬限制，过高仍可能触发站点风控。</p>
      </div>

      <div class="space-y-1.5">
        <Label>单站超时（秒）</Label>
        <Input v-model.number="dk.timeout" type="number" min="1" class="w-28" />
        <p class="text-xs text-muted-foreground">单个站点请求超过该时长视为失败。</p>
      </div>

      <div class="space-y-1.5">
        <Label>失败重试次数</Label>
        <Input v-model.number="dk.retry" type="number" min="0" max="5" class="w-28" />
        <p class="text-xs text-muted-foreground">失败站点按此次数退避重试。</p>
      </div>

      <div class="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button @click="onSave">保存设置</Button>
      </div>
    </div>
  </div>
</template>
