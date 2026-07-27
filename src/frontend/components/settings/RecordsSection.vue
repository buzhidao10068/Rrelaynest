<script setup lang="ts">
// 记录分区：充值 / 签到 / 爬取三 tab，各列全站流水（时间倒序，演示端仅存本次会话）。
import { ref, computed } from 'vue';
import { recordsState, fmtTs } from '@/stores/records';
import { curSign } from '@/stores/sites';

type Tab = 'recharge' | 'checkin' | 'scrape';
const tab = ref<Tab>('recharge');

const tabs: { key: Tab; label: string }[] = [
  { key: 'recharge', label: '充值' },
  { key: 'checkin', label: '签到' },
  { key: 'scrape', label: '爬取' },
];

interface Row { site: string; mid: string; ts: number; }

const rows = computed<Row[]>(() => {
  if (tab.value === 'recharge') {
    return recordsState.recharge.map((r) => ({
      site: r.site,
      mid: `充 ¥${r.rmb.toFixed(2)} → 到账 ${curSign(r.cur)}${r.amount.toFixed(2)}`,
      ts: r.ts,
    }));
  }
  if (tab.value === 'checkin') {
    return recordsState.checkin.map((r) => ({
      site: r.site,
      mid: `签到到账 ${curSign(r.cur)}${r.amount.toFixed(2)}`,
      ts: r.ts,
    }));
  }
  return recordsState.scrape.map((r) => ({
    site: r.site,
    mid: r.ok ? `爬取余额 ${curSign(r.cur)}${(r.balance ?? 0).toFixed(2)}` : '爬取失败',
    ts: r.ts,
  }));
});

const emptyMsg = computed(() => {
  if (tab.value === 'recharge') return '暂无充值记录。在站点行点「充值」即可记录一次。';
  if (tab.value === 'checkin') return '暂无签到记录。在站点行点「签到」即可记录。';
  return '暂无爬取记录。点「爬取」或「全部爬取」即可记录。';
});
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-base font-semibold">记录</h3>
      <p class="mt-1 text-sm text-muted-foreground">充值、签到、爬取的历史流水（演示端仅存本次会话）。</p>
    </div>

    <div class="inline-flex overflow-hidden rounded-md border border-border text-sm">
      <button
        v-for="(t, i) in tabs"
        :key="t.key"
        class="px-3 py-1.5"
        :class="[
          i > 0 ? 'border-l border-border' : '',
          tab === t.key ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground',
        ]"
        @click="tab = t.key"
      >
        {{ t.label }}
      </button>
    </div>

    <div v-if="rows.length" class="rounded-lg border border-border">
      <div
        v-for="(r, i) in rows"
        :key="i"
        class="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 text-sm last:border-0"
      >
        <span class="min-w-0 flex-1 truncate font-medium">{{ r.site }}</span>
        <span class="shrink-0 text-muted-foreground">{{ r.mid }}</span>
        <span class="w-24 shrink-0 text-right text-xs text-muted-foreground">{{ fmtTs(r.ts) }}</span>
      </div>
    </div>
    <div
      v-else
      class="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground"
    >
      {{ emptyMsg }}
    </div>
  </div>
</template>
