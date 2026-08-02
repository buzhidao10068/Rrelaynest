<script setup lang="ts">
// 两步验证（TOTP）注册向导：三步——① setup 拿密钥/otpauth URI 并渲染二维码 →
// ② 输入验证器生成的 6 位码调 enable 确认 → ③ 展示一次性备份码（仅此一次）。
// 关掉对话框（完成或取消）时通知父组件刷新 2FA 状态。见 shared/routes.ts 的 /api/account/totp/*。
import { ref, watch } from 'vue';
import QRCode from 'qrcode';
import { useI18n } from 'vue-i18n';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/api';
import { toast } from '@/composables/useToast';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close', enabled: boolean): void }>();

const { t } = useI18n({ useScope: 'global' });

type Step = 'loading' | 'scan' | 'done';
const step = ref<Step>('loading');
const secret = ref('');
const qrDataUrl = ref('');
const code = ref('');
const busy = ref(false);
const backupCodes = ref<string[]>([]);
const errorMsg = ref('');

// 打开时启动 setup 流程；关闭时复位。
watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    step.value = 'loading';
    secret.value = '';
    qrDataUrl.value = '';
    code.value = '';
    backupCodes.value = [];
    errorMsg.value = '';
    try {
      const r = await api.post<{ secret: string; otpauthUri: string }>('/api/account/totp/setup');
      secret.value = r.secret;
      qrDataUrl.value = await QRCode.toDataURL(r.otpauthUri, { margin: 1, width: 200 });
      step.value = 'scan';
    } catch (e) {
      // 401 交给 api 层登出；其余在对话框内提示并允许关闭。
      if (e instanceof ApiError && e.status === 401) return;
      errorMsg.value = e instanceof Error ? e.message : t('settings.totp.initFailed');
    }
  },
);

async function confirmEnable() {
  if (busy.value) return;
  const c = code.value.trim();
  if (!/^\d{6}$/.test(c)) {
    toast(t('settings.totp.needSixDigit'), 'error');
    return;
  }
  busy.value = true;
  try {
    const r = await api.post<{ ok: boolean; backupCodes: string[] }>('/api/account/totp/enable', { code: c });
    backupCodes.value = r.backupCodes ?? [];
    step.value = 'done';
    toast(t('settings.totp.enabledToast'), 'success');
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) {
      toast(e instanceof Error ? e.message : t('settings.totp.enableFailed'), 'error');
    }
  } finally {
    busy.value = false;
  }
}

function copyBackup() {
  const text = backupCodes.value.join('\n');
  navigator.clipboard?.writeText(text).then(
    () => toast(t('settings.totp.copiedToast'), 'success'),
    () => toast(t('settings.totp.copyFailed'), 'error'),
  );
}

// 关闭：done 步说明已启用，其余步骤视为未启用（setup 只暂存密钥，未 enable 不影响登录）。
function close() {
  emit('close', step.value === 'done');
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => { if (!v) close(); }">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{{ t('settings.totp.enableTitle') }}</DialogTitle>
        <DialogDescription>
          {{ t('settings.totp.enableDesc') }}
        </DialogDescription>
      </DialogHeader>

      <!-- 加载中 -->
      <div v-if="step === 'loading'" class="py-8 text-center text-sm text-muted-foreground">
        <span v-if="errorMsg" class="text-red-500">{{ errorMsg }}</span>
        <span v-else>{{ t('settings.totp.initializing') }}</span>
      </div>

      <!-- 扫码 + 输入码 -->
      <div v-else-if="step === 'scan'" class="space-y-4">
        <div class="flex flex-col items-center gap-3">
          <img v-if="qrDataUrl" :src="qrDataUrl" :alt="t('settings.totp.qrAlt')" class="rounded-md border border-border" width="200" height="200" />
          <div class="w-full space-y-1">
            <p class="text-xs text-muted-foreground">{{ t('settings.totp.manualEntry') }}</p>
            <code class="block break-all rounded-md bg-muted px-3 py-2 text-center text-sm font-mono tracking-wider">{{ secret }}</code>
          </div>
        </div>
        <div class="space-y-1.5">
          <Label>{{ t('settings.totp.codeLabel') }}</Label>
          <Input
            v-model="code"
            inputmode="numeric"
            maxlength="6"
            placeholder="000000"
            class="text-center text-lg tracking-[0.5em]"
            @keyup.enter="confirmEnable"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" @click="close">{{ t('common.cancel') }}</Button>
          <Button :disabled="busy" @click="confirmEnable">{{ busy ? t('settings.totp.verifying') : t('settings.totp.confirmEnable') }}</Button>
        </DialogFooter>
      </div>

      <!-- 备份码 -->
      <div v-else class="space-y-4">
        <div class="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
          {{ t('settings.totp.backupWarning') }}
        </div>
        <div class="grid grid-cols-2 gap-2">
          <code
            v-for="bc in backupCodes"
            :key="bc"
            class="rounded-md bg-muted px-2 py-1.5 text-center text-sm font-mono tracking-wider"
          >{{ bc }}</code>
        </div>
        <DialogFooter class="gap-2">
          <Button variant="outline" @click="copyBackup">{{ t('settings.totp.copyAll') }}</Button>
          <Button @click="close">{{ t('settings.totp.saved') }}</Button>
        </DialogFooter>
      </div>
    </DialogContent>
  </Dialog>
</template>
