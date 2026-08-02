<script setup lang="ts">
// 签到分区：自动签到全局默认行为。新增站点默认开启签到 + 跨天重置时区，均接后端 /api/settings。
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { settingsState, setCheckinDefault, setTimezone } from '@/stores/settings';
import { ApiError } from '@/api';
import { toast } from '@/composables/useToast';

const { t } = useI18n({ useScope: 'global' });

// Switch 用受控写法：变更时乐观更新 + 打后端，失败回滚（settingsState 由后端 load 权威）。
async function onCheckinDefaultChange(v: boolean) {
  const prev = settingsState.checkinDefaultOn;
  settingsState.checkinDefaultOn = v; // 乐观
  try {
    await setCheckinDefault(v);
    toast(v ? t('settings.checkin.defaultOnToast') : t('settings.checkin.defaultOffToast'), 'success');
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
    toast(t('settings.checkin.tzUpdatedToast'), 'success');
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
      <h3 class="text-base font-semibold">{{ t('settings.checkin.title') }}</h3>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.checkin.desc') }}</p>
    </div>

    <div class="flex items-center gap-4 rounded-lg border border-border p-4">
      <Switch :model-value="settingsState.checkinDefaultOn" @update:model-value="onCheckinDefaultChange" />
      <div>
        <p class="text-sm font-medium">{{ t('settings.checkin.defaultOn') }}</p>
        <p class="text-xs text-muted-foreground">{{ t('settings.checkin.defaultOnDesc') }}</p>
      </div>
    </div>

    <div class="space-y-1.5">
      <Label>{{ t('settings.checkin.timezone') }}</Label>
      <Input v-model="tzInput" class="w-64" placeholder="Asia/Shanghai" @blur="onTimezoneBlur" />
      <p class="text-xs text-muted-foreground">
        <i18n-t keypath="settings.checkin.timezoneHint" tag="span" scope="global">
          <template #tz1><code>Asia/Shanghai</code></template>
          <template #tz2><code>America/New_York</code></template>
        </i18n-t>
      </p>
    </div>

    <div class="rounded-lg border border-border p-4">
      <p class="text-sm font-medium">{{ t('settings.checkin.turnstileTitle') }}</p>
      <p class="mt-1 text-xs text-muted-foreground">
        {{ t('settings.checkin.turnstileDesc') }}
      </p>
    </div>
  </div>
</template>
