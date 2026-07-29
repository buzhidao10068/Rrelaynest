<script setup lang="ts">
// 签到分区：自动签到全局默认行为。新增站点默认开启签到 + 跨天重置时区，均接后端 /api/settings。
import { ref, watch } from 'vue';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { settingsState, setCheckinDefault, setTimezone } from '@/stores/settings';
import { ApiError } from '@/api';
import { toast } from '@/composables/useToast';

// Switch 用受控写法：变更时乐观更新 + 打后端，失败回滚（settingsState 由后端 load 权威）。
async function onCheckinDefaultChange(v: boolean) {
  const prev = settingsState.checkinDefaultOn;
  settingsState.checkinDefaultOn = v; // 乐观
  try {
    await setCheckinDefault(v);
    toast(v ? '新增站点将默认开启签到' : '新增站点默认不开启签到', 'success');
  } catch (e) {
    settingsState.checkinDefaultOn = prev; // 回滚
    if (e instanceof ApiError && e.status !== 401) toast(e.message, 'error');
  }
}

// 时区本地编辑态，随 store（后端 load 后）同步；失焦时提交。
const tzInput = ref(settingsState.timezone);
watch(() => settingsState.timezone, (v) => { tzInput.value = v; });

async function onTimezoneBlur() {
  const next = tzInput.value.trim();
  if (!next || next === settingsState.timezone) {
    tzInput.value = settingsState.timezone; // 空值/未变：回填
    return;
  }
  const prev = settingsState.timezone;
  try {
    await setTimezone(next);
    toast('已更新跨天重置时区', 'success');
  } catch (e) {
    settingsState.timezone = prev;
    tzInput.value = prev;
    if (e instanceof ApiError && e.status !== 401) toast(e.message, 'error');
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-base font-semibold">签到</h3>
      <p class="mt-1 text-sm text-muted-foreground">自动签到的全局默认行为。</p>
    </div>

    <div class="flex items-center gap-4 rounded-lg border border-border p-4">
      <Switch :model-value="settingsState.checkinDefaultOn" @update:model-value="onCheckinDefaultChange" />
      <div>
        <p class="text-sm font-medium">新增站点默认开启签到</p>
        <p class="text-xs text-muted-foreground">新建站点时预勾选自动签到。</p>
      </div>
    </div>

    <div class="space-y-1.5">
      <Label>跨天重置时区</Label>
      <Input v-model="tzInput" class="w-64" placeholder="Asia/Shanghai" @blur="onTimezoneBlur" />
      <p class="text-xs text-muted-foreground">
        IANA 时区名（如 <code>Asia/Shanghai</code>、<code>America/New_York</code>），用于判定“新的一天”，决定何时把签到状态重置为未签。
      </p>
    </div>

    <div class="rounded-lg border border-border p-4">
      <p class="text-sm font-medium">Turnstile 站点</p>
      <p class="mt-1 text-xs text-muted-foreground">
        开启了人机验证的站点无法自动签到，会标记为“需手动”，不影响其他站。
      </p>
    </div>
  </div>
</template>
