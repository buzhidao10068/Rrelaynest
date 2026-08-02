<script setup lang="ts">
// 记录分区：充值 / 签到 / 爬取三 tab，各列全站流水（时间倒序，演示端仅存本次会话）。
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { recordsState, fmtTs } from '@/stores/records';
import { curSign } from '@/stores/sites';

const { t } = useI18n({ useScope: 'global' });

type Tab = 'recharge' | 'checkin' | 'scrape';
const tab = ref<Tab>('recharge');

const tabs: { key: Tab; labelKey: string }[] = [
  { key: 'recharge', labelKey: 'settings.records.tabRecharge' },
  { key: 'checkin', labelKey: 'settings.records.tabCheckin' },
  { key: 'scrape', labelKey: 'settings.records.tabScrape' },
];

interface Row { site: string; mid: string; ts: number; }

const rows = computed<Row[]>(() => {
  if (tab.value === 'recharge') {
    return recordsState.recharge.map((r) => ({
      site: r.site,
      mid: t('settings.records.rechargeMid', { rmb: r.rmb.toFixed(2), sign: curSign(r.cur), amount: r.amount.toFixed(2) }),
      ts: r.ts,
    }));
  }
  if (tab.value === 'checkin') {
    return recordsState.checkin.map((r) => ({
      site: r.site,
      mid: t('settings.records.checkinMid', { sign: curSign(r.cur), amount: r.amount.toFixed(2) }),
      ts: r.ts,
    }));
  }
  return recordsState.scrape.map((r) => ({
    site: r.site,
    mid: r.ok ? t('settings.records.scrapeMid', { sign: curSign(r.cur), amount: (r.balance ?? 0).toFixed(2) }) : t('settings.records.scrapeFailed'),
    ts: r.ts,
  }));
});

const emptyMsg = computed(() => {
  if (tab.value === 'recharge') return t('settings.records.emptyRecharge');
  if (tab.value === 'checkin') return t('settings.records.emptyCheckin');
  return t('settings.records.emptyScrape');
});
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-base font-semibold">{{ t('settings.records.title') }}</h3>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.records.desc') }}</p>
    </div>

    <div class="inline-flex overflow-hidden rounded-md border border-border text-sm">
      <button
        v-for="(tb, i) in tabs"
        :key="tb.key"
        class="px-3 py-1.5"
        :class="[
          i > 0 ? 'border-l border-border' : '',
          tab === tb.key ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground',
        ]"
        @click="tab = tb.key"
      >
        {{ t(tb.labelKey) }}
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
