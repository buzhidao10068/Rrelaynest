<script setup lang="ts">
// 签到分区：自动签到全局默认行为。新增站点默认开启签到（落 settings store）+ 时区 + Turnstile 提示。
import { computed } from 'vue';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { settingsState, setCheckinDefault, persistTimezone } from '@/stores/settings';
import { toast } from '@/composables/useToast';

const checkinDefault = computed({
  get: () => settingsState.checkinDefaultOn,
  set: (v: boolean) => {
    setCheckinDefault(v);
    toast(v ? '新增站点将默认开启签到' : '新增站点默认不开启签到', 'success');
  },
});

function onTimezoneBlur() {
  persistTimezone();
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-base font-semibold">签到</h3>
      <p class="mt-1 text-sm text-muted-foreground">自动签到的全局默认行为。</p>
    </div>

    <div class="flex items-center gap-4 rounded-lg border border-border p-4">
      <Switch v-model="checkinDefault" />
      <div>
        <p class="text-sm font-medium">新增站点默认开启签到</p>
        <p class="text-xs text-muted-foreground">新建站点时预勾选自动签到。</p>
      </div>
    </div>

    <div class="space-y-1.5">
      <Label>跨天重置时区</Label>
      <Input v-model="settingsState.timezone" class="w-64" @blur="onTimezoneBlur" />
      <p class="text-xs text-muted-foreground">用于判定“新的一天”，决定何时把签到状态重置为未签。</p>
    </div>

    <div class="rounded-lg border border-border p-4">
      <p class="text-sm font-medium">Turnstile 站点</p>
      <p class="mt-1 text-xs text-muted-foreground">
        开启了人机验证的站点无法自动签到，会标记为“需手动”，不影响其他站。
      </p>
    </div>
  </div>
</template>
