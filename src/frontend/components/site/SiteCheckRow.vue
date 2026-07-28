<script setup lang="ts">
// 测活页单站行：站名/地址 + 整体连接/渠道徽章 + 单站「测连接」「测渠道」按钮 + 模型明细 chips。
// 平铺与分组两种视图共用本组件；共享状态与检测函数来自 useActivityCheck 单例。
import { Wifi, MessageSquare } from 'lucide-vue-next';
import { Button } from '@/components/ui/button';
import { type Site } from '@/stores/sites';
import {
  connResults, modelResults, busySites, running,
  connBadgeClass, connBadgeText, modelBadgeClass, modelBadgeText, modelChipClass,
  runConnectivityCheck, runModelCheck,
} from '@/composables/useActivityCheck';

defineProps<{ site: Site }>();
</script>

<template>
  <div class="px-4 py-3">
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        <p class="truncate text-sm font-medium">{{ site.name }}</p>
        <p class="truncate text-xs text-muted-foreground">{{ site.url }}</p>
      </div>
      <div class="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <span
          v-if="connResults[site.id]"
          class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
          :class="connBadgeClass(connResults[site.id].status)"
        >{{ connBadgeText(connResults[site.id]) }}</span>
        <span
          v-else
          class="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
        >连接 待检</span>
        <span
          v-if="modelResults[site.id]"
          class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
          :class="modelBadgeClass(modelResults[site.id].status)"
        >{{ modelBadgeText(modelResults[site.id]) }}</span>
        <span
          v-else
          class="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
        >渠道 待检</span>

        <!-- 单站按钮 -->
        <Button
          variant="ghost" size="sm"
          class="h-7 px-2"
          :disabled="running || busySites.has(site.id)"
          title="仅测本站连接"
          @click="runConnectivityCheck(site.id)"
        >
          <Wifi :size="14" />
          测连接
        </Button>
        <Button
          variant="ghost" size="sm"
          class="h-7 px-2"
          :disabled="running || busySites.has(site.id)"
          title="仅测本站渠道（逐模型）"
          @click="runModelCheck(site.id)"
        >
          <MessageSquare :size="14" />
          测渠道
        </Button>
      </div>
    </div>

    <!-- 模型明细 chips：可用绿 / 不可用红 / 测试中蓝 -->
    <div
      v-if="modelResults[site.id]?.models.length"
      class="mt-2 flex flex-wrap gap-1.5"
    >
      <span
        v-for="m in modelResults[site.id].models"
        :key="m.id"
        class="inline-flex items-center rounded-md px-2 py-0.5 font-mono text-xs font-medium"
        :class="modelChipClass(m.status)"
      >{{ m.id }}</span>
    </div>
  </div>
</template>
