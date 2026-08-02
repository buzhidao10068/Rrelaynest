<script setup lang="ts">
// 安全分区：修改密码 + 两步验证(TOTP) + Passkey + 登出所有设备，全部真接后端。
// - 改密 / 登出所有设备：靠 session_version +1 即时吊销旧会话（见 [[frontend-wiring-block8]]）。
// - 两步验证：状态读 /api/me 的 totp_enabled；启用走 TotpEnrollDialog（setup→enable），
//     停用需验当前密码（POST /api/account/totp/disable）。见 shared/routes.ts、shared/totp.ts。
// - Passkey：列 /api/account/passkeys；添加走 register/options→浏览器 create→register/verify；
//     删除 DELETE /api/account/passkeys/:id。见 shared/routes.ts 的 /api/account/passkey/*。
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { Lock, Fingerprint, Trash2 } from 'lucide-vue-next';
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/api';
import { clearSession } from '@/stores/users';
import { showView } from '@/stores/ui';
import { toast } from '@/composables/useToast';
import TotpEnrollDialog from './TotpEnrollDialog.vue';

const { t } = useI18n({ useScope: 'global' });

// ---- 两步验证状态 ----
const totpEnabled = ref(false);
const totpLoaded = ref(false);
const enrollOpen = ref(false);

async function loadMfaStatus() {
  try {
    const me = await api.get<{ totp_enabled?: boolean }>('/api/me');
    totpEnabled.value = !!me.totp_enabled;
    totpLoaded.value = true;
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) totpLoaded.value = true;
  }
}
onMounted(loadMfaStatus);

function onEnrollClose(enabled: boolean) {
  enrollOpen.value = false;
  if (enabled) totpEnabled.value = true;
}

// ---- Passkey 管理 ----
interface PasskeyRow {
  id: number;
  name: string | null;
  created_at: number;
  last_used_at: number | null;
}
const passkeySupported = ref(false);
const passkeys = ref<PasskeyRow[]>([]);
const passkeysLoaded = ref(false);
const addingPasskey = ref(false);

async function loadPasskeys() {
  try {
    const r = await api.get<{ passkeys: PasskeyRow[] }>('/api/account/passkeys');
    passkeys.value = r.passkeys ?? [];
    passkeysLoaded.value = true;
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) passkeysLoaded.value = true;
  }
}
onMounted(() => {
  passkeySupported.value = browserSupportsWebAuthn();
  if (passkeySupported.value) loadPasskeys();
});

// 添加 Passkey：① 取注册 options + 挑战票 → ② 浏览器唤起认证器创建凭证 →
// ③ 凭票 + 断言 + 可选名称走 register/verify 落库。成功后刷新列表。
async function addPasskey() {
  if (addingPasskey.value) return;
  addingPasskey.value = true;
  try {
    const { options, ticket } = await api.post<{
      options: PublicKeyCredentialCreationOptionsJSON;
      ticket: string;
    }>('/api/account/passkey/register/options');
    const response = await startRegistration({ optionsJSON: options });
    // 设备名：取平台默认（可留空，后端存 NULL）。这里用简单的时间戳可读名兜底，用户可后续管理。
    const name = defaultPasskeyName();
    await api.post('/api/account/passkey/register/verify', { ticket, response, name });
    toast(t('settings.security.passkeyAddedToast'), 'success');
    await loadPasskeys();
  } catch (e) {
    if (e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError')) return;
    if (!(e instanceof ApiError && e.status === 401)) {
      toast(e instanceof Error ? e.message : t('settings.security.passkeyAddFailed'), 'error');
    }
  } finally {
    addingPasskey.value = false;
  }
}

// 缺省设备名：用当前日期，便于用户区分（如「Passkey · 2026/7/29」）。
function defaultPasskeyName(): string {
  return `Passkey · ${new Date().toLocaleDateString()}`;
}

async function removePasskey(id: number) {
  if (!window.confirm(t('settings.security.passkeyRemoveConfirm'))) return;
  try {
    await api.del(`/api/account/passkeys/${id}`);
    passkeys.value = passkeys.value.filter((p) => p.id !== id);
    toast(t('settings.security.passkeyRemovedToast'), 'success');
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) {
      toast(e instanceof Error ? e.message : t('settings.security.passkeyDeleteFailed'), 'error');
    }
  }
}

// ---- 停用两步验证（需验当前密码）----
const disableOpen = ref(false);
const disablePassword = ref('');
const disabling = ref(false);
async function confirmDisable() {
  if (disabling.value) return;
  if (!disablePassword.value) {
    toast(t('settings.security.needCurrentPw'), 'error');
    return;
  }
  disabling.value = true;
  try {
    await api.post('/api/account/totp/disable', { password: disablePassword.value });
    totpEnabled.value = false;
    disableOpen.value = false;
    disablePassword.value = '';
    toast(t('settings.security.totpDisabledToast'), 'success');
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) {
      toast(e instanceof Error ? e.message : t('settings.security.totpDisableFailed'), 'error');
    }
  } finally {
    disabling.value = false;
  }
}

// ---- 登出所有设备 ----
const loggingOutAll = ref(false);
async function logoutAll() {
  if (loggingOutAll.value) return;
  if (!window.confirm(t('settings.security.logoutAllConfirm'))) return;
  loggingOutAll.value = true;
  try {
    await api.post('/api/account/logout-all');
    toast(t('settings.security.logoutAllToast'), 'success');
    clearSession();
    showView('login');
  } catch (e) {
    toast(e instanceof ApiError ? e.message : t('settings.security.logoutAllFailed'), 'error');
  } finally {
    loggingOutAll.value = false;
  }
}

// ---- 修改密码 ----
const current = ref('');
const next = ref('');
const confirm = ref('');
const busy = ref(false);

// 前端预校验（后端仍权威兜底）：三项非空、新密码 ≥8 位、两次一致、新旧不同。
const canSubmit = computed(
  () =>
    !busy.value &&
    current.value.length > 0 &&
    next.value.length >= 8 &&
    next.value === confirm.value &&
    next.value !== current.value,
);

async function changePassword() {
  if (busy.value) return;
  if (next.value.length < 8) {
    toast(t('settings.security.pwMin8'), 'error');
    return;
  }
  if (next.value !== confirm.value) {
    toast(t('settings.security.pwMismatch'), 'error');
    return;
  }
  if (next.value === current.value) {
    toast(t('settings.security.pwSameAsOld'), 'error');
    return;
  }
  busy.value = true;
  try {
    await api.post('/api/account/password', { current: current.value, next: next.value });
    current.value = '';
    next.value = '';
    confirm.value = '';
    toast(t('settings.security.pwUpdatedToast'), 'success');
  } catch (e) {
    toast(e instanceof ApiError ? e.message : t('settings.security.pwUpdateFailed'), 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-base font-semibold">{{ t('settings.security.title') }}</h3>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.security.desc') }}</p>
    </div>

    <!-- 修改密码 -->
    <div class="rounded-lg border border-border p-5">
      <p class="text-sm font-medium">{{ t('settings.security.changePassword') }}</p>
      <div class="mt-4 space-y-3">
        <div class="flex items-center gap-4">
          <Label class="w-24 shrink-0 text-right text-muted-foreground">{{ t('settings.security.currentPw') }}</Label>
          <Input v-model="current" type="password" :placeholder="t('settings.security.currentPwPlaceholder')" class="w-80" autocomplete="current-password" />
        </div>
        <div class="flex items-center gap-4">
          <Label class="w-24 shrink-0 text-right text-muted-foreground">{{ t('settings.security.newPw') }}</Label>
          <Input v-model="next" type="password" :placeholder="t('settings.security.newPwPlaceholder')" class="w-80" autocomplete="new-password" />
        </div>
        <div class="flex items-center gap-4">
          <Label class="w-24 shrink-0 text-right text-muted-foreground">{{ t('settings.security.confirmPw') }}</Label>
          <Input v-model="confirm" type="password" :placeholder="t('settings.security.confirmPwPlaceholder')" class="w-80" autocomplete="new-password" @keyup.enter="changePassword" />
        </div>
        <div class="flex items-center gap-4">
          <span class="w-24 shrink-0" />
          <Button :disabled="!canSubmit" @click="changePassword">{{ busy ? t('settings.security.updating') : t('settings.security.updatePw') }}</Button>
        </div>
      </div>
    </div>

    <!-- 两步验证 -->
    <div class="rounded-lg border border-border p-5">
      <div class="flex items-start gap-3">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Lock :size="18" />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p class="text-sm font-medium">{{ t('settings.security.totpTitle') }}</p>
            <span
              v-if="totpLoaded"
              class="rounded-full px-2 py-0.5 text-xs font-medium"
              :class="totpEnabled
                ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'"
            >{{ totpEnabled ? t('common.enabled') : t('settings.security.totpNotEnabled') }}</span>
          </div>
          <p class="mt-1 text-xs text-muted-foreground">
            {{ t('settings.security.totpDesc') }}
          </p>
        </div>
        <Button v-if="totpLoaded && !totpEnabled" class="shrink-0" @click="enrollOpen = true">{{ t('common.enable') }}</Button>
        <Button v-else-if="totpLoaded && totpEnabled" variant="outline" class="shrink-0" @click="disableOpen = true">{{ t('settings.security.totpTurnOff') }}</Button>
      </div>
    </div>

    <!-- Passkey（无密码登录）-->
    <div class="rounded-lg border border-border p-5">
      <div class="flex items-start gap-3">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Fingerprint :size="18" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium">{{ t('settings.security.passkeyTitle') }}</p>
          <p class="mt-1 text-xs text-muted-foreground">
            {{ t('settings.security.passkeyDesc') }}
          </p>
        </div>
        <Button
          v-if="passkeySupported"
          class="shrink-0"
          :disabled="addingPasskey"
          @click="addPasskey"
        >{{ addingPasskey ? t('settings.security.passkeyAdding') : t('settings.security.passkeyAdd') }}</Button>
      </div>

      <!-- 浏览器不支持 -->
      <p v-if="!passkeySupported" class="mt-3 text-xs text-amber-600 dark:text-amber-400">
        {{ t('settings.security.passkeyUnsupported') }}
      </p>

      <!-- 已注册列表 -->
      <ul v-else-if="passkeys.length" class="mt-4 space-y-2">
        <li
          v-for="pk in passkeys"
          :key="pk.id"
          class="flex items-center gap-3 rounded-md border border-border px-3 py-2"
        >
          <Fingerprint :size="16" class="shrink-0 text-muted-foreground" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm">{{ pk.name || `Passkey #${pk.id}` }}</p>
            <p class="text-xs text-muted-foreground">
              {{ t('settings.security.addedAt', { date: new Date(pk.created_at).toLocaleString() }) }}
              <template v-if="pk.last_used_at"> {{ t('settings.security.lastUsed', { date: new Date(pk.last_used_at).toLocaleString() }) }}</template>
            </p>
          </div>
          <button
            type="button"
            class="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-red-500"
            :title="t('common.delete')"
            @click="removePasskey(pk.id)"
          >
            <Trash2 :size="15" />
          </button>
        </li>
      </ul>

      <!-- 支持但尚无凭证 -->
      <p v-else-if="passkeysLoaded" class="mt-3 text-xs text-muted-foreground">
        {{ t('settings.security.passkeyEmpty') }}
      </p>
    </div>

    <!-- 会话 -->
    <div class="rounded-lg border border-border p-5">
      <p class="text-sm font-medium">{{ t('settings.security.session') }}</p>
      <p class="mt-1 text-xs text-muted-foreground">{{ t('settings.security.sessionDesc') }}</p>
      <Button variant="outline" size="sm" class="mt-3" :disabled="loggingOutAll" @click="logoutAll">{{ loggingOutAll ? t('settings.security.loggingOutAll') : t('settings.security.logoutAll') }}</Button>
    </div>

    <!-- 注册向导 -->
    <TotpEnrollDialog :open="enrollOpen" @close="onEnrollClose" />

    <!-- 停用确认（验当前密码）-->
    <Dialog :open="disableOpen" @update:open="(v) => { if (!v) { disableOpen = false; disablePassword = ''; } }">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{{ t('settings.security.disableTotpTitle') }}</DialogTitle>
          <DialogDescription>{{ t('settings.security.disableTotpDesc') }}</DialogDescription>
        </DialogHeader>
        <div class="space-y-1.5">
          <Label>{{ t('settings.security.currentPw') }}</Label>
          <Input v-model="disablePassword" type="password" autocomplete="current-password" :placeholder="t('settings.security.currentPwPlaceholder')" @keyup.enter="confirmDisable" />
        </div>
        <DialogFooter>
          <Button variant="outline" @click="disableOpen = false; disablePassword = '';">{{ t('common.cancel') }}</Button>
          <Button :disabled="disabling" @click="confirmDisable">{{ disabling ? t('settings.security.disabling') : t('settings.security.confirmDisable') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
