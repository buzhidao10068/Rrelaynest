<script setup lang="ts">
// 登录页。真实端：POST /api/login {username, password}。
// 开了两步验证的用户：第一步不发会话，改返 { mfaRequired, ticket }；前端切到第二步，
// 凭 ticket + 6 位 TOTP 码（或备份码）走 POST /api/login/totp 换会话。见 shared/routes.ts。
import { ref, nextTick, onMounted } from 'vue';
import { ShieldCheck, KeyRound, Fingerprint } from 'lucide-vue-next';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { useI18n } from 'vue-i18n';
import { useLocale } from '@/i18n/useLocale';
import { showView, setDeployPlatform } from '@/stores/ui';
import type { DeployPlatform } from '@/stores/ui';
import { setSession } from '@/stores/users';
import { loadDisclaimer } from '@/stores/disclaimer';
import { api } from '@/api';
import { toast } from '@/composables/useToast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const { t } = useI18n({ useScope: 'global' });
const { locale, setLocale, locales } = useLocale();

const username = ref('');
const password = ref('');
const busy = ref(false);

// Passkey（无密码登录）：仅在浏览器支持 WebAuthn 时展示入口。
const passkeySupported = ref(false);
const passkeyBusy = ref(false);
onMounted(() => {
  passkeySupported.value = browserSupportsWebAuthn();
});

// 两步验证第二步状态
const mfaTicket = ref<string | null>(null); // 非空 = 进入第二步
const mfaCode = ref('');
const codeInput = ref<InstanceType<typeof Input> | null>(null);

// 会话就绪后回查角色/用户名并进主页（三条登录路径共用：密码 / 两步 / Passkey）。
// 顺带写入后端下发的部署平台（权威值，前端不猜）。
async function finishLogin() {
  const s = await api.get<{
    authenticated: boolean;
    id?: number;
    username?: string;
    role?: string;
    platform?: DeployPlatform;
  }>('/api/session');
  setDeployPlatform(s.platform ?? null);
  setSession(s.id ?? null, s.username ?? username.value, s.role === 'admin' ? 'admin' : 'user');
  password.value = '';
  mfaCode.value = '';
  mfaTicket.value = null;
  await loadDisclaimer(); // 进主面板前先读免责同意态，未同意则 App 直接渲染门禁（无闪现）
  showView('dashboard');
}

async function login() {
  if (busy.value) return;
  if (!username.value || !password.value) {
    toast(t('login.needUserPass'), 'error');
    return;
  }
  busy.value = true;
  try {
    const r = await api.post<{ ok?: boolean; mfaRequired?: boolean; ticket?: string }>('/api/login', {
      username: username.value,
      password: password.value,
    });
    if (r?.mfaRequired && r.ticket) {
      // 进入第二步：保留 ticket，聚焦验证码输入框。
      mfaTicket.value = r.ticket;
      await nextTick();
      codeInput.value?.$el?.focus?.();
      return;
    }
    await finishLogin();
  } catch (e) {
    toast(e instanceof Error ? e.message : t('login.failed'), 'error');
  } finally {
    busy.value = false;
  }
}

async function submitMfa() {
  if (busy.value || !mfaTicket.value) return;
  const code = mfaCode.value.trim();
  if (!code) {
    toast(t('login.needCode'), 'error');
    return;
  }
  busy.value = true;
  try {
    await api.post('/api/login/totp', { ticket: mfaTicket.value, code });
    await finishLogin();
  } catch (e) {
    toast(e instanceof Error ? e.message : t('login.verifyFailed'), 'error');
  } finally {
    busy.value = false;
  }
}

// 放弃第二步、回到密码步（如输错账号或想换账号登录）。
function cancelMfa() {
  mfaTicket.value = null;
  mfaCode.value = '';
  password.value = '';
}

// 无密码登录（Passkey）：① 取认证 options + 挑战票 → ② 浏览器唤起认证器签名 →
// ③ 凭票 + 断言走 /api/login/passkey/verify 换会话。Passkey 已含用户验证（强因子），
// 登录成功即免第二步 TOTP。见 shared/routes.ts 的 /api/login/passkey/*。
async function loginPasskey() {
  if (passkeyBusy.value) return;
  passkeyBusy.value = true;
  try {
    const { options, ticket } = await api.post<{
      options: PublicKeyCredentialRequestOptionsJSON;
      ticket: string;
    }>('/api/login/passkey/options');
    // 唤起认证器（用户取消会 throw，归类为「已取消」而非报错）。
    const response = await startAuthentication({ optionsJSON: options });
    await api.post('/api/login/passkey/verify', { ticket, response });
    await finishLogin();
  } catch (e) {
    // 用户主动取消（NotAllowedError / AbortError）不弹错误提示。
    if (e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError')) return;
    toast(e instanceof Error ? e.message : t('login.passkeyFailed'), 'error');
  } finally {
    passkeyBusy.value = false;
  }
}
</script>

<template>
  <div class="relative flex min-h-screen items-center justify-center p-6">
    <!-- 登录前语言切换：固定右上角，简/繁/EN 段控（hover 出全名），登录后侧栏还有一处 -->
    <div class="absolute right-4 top-4 inline-flex overflow-hidden rounded-md border border-border text-xs">
      <button
        v-for="(seg, i) in locales"
        :key="seg.key"
        type="button"
        class="px-2.5 py-1"
        :title="seg.label"
        :class="[
          i > 0 ? 'border-l border-border' : '',
          locale === seg.key
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:text-foreground',
        ]"
        @click="setLocale(seg.key)"
      >
        {{ seg.short }}
      </button>
    </div>

    <div class="w-[400px] space-y-6 rounded-lg border border-border bg-card p-8 shadow-sm">
      <div class="flex flex-col items-center gap-2">
        <div class="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ShieldCheck :size="22" />
        </div>
        <h1 class="text-2xl font-semibold tracking-tight">Rrelaynest</h1>
        <p class="text-sm text-muted-foreground">{{ t('login.subtitle') }}</p>
      </div>
      <!-- 第一步：用户名 + 密码 -->
      <template v-if="!mfaTicket">
        <div class="space-y-2">
          <Label>{{ t('login.username') }}</Label>
          <Input
            v-model="username"
            type="text"
            :placeholder="t('login.usernamePlaceholder')"
            autocomplete="username"
            @keydown.enter="login"
          />
        </div>
        <div class="space-y-2">
          <Label>{{ t('login.password') }}</Label>
          <Input
            v-model="password"
            type="password"
            :placeholder="t('login.passwordPlaceholder')"
            autocomplete="current-password"
            @keydown.enter="login"
          />
        </div>
        <Button class="w-full" :disabled="busy" @click="login">
          {{ busy ? t('login.submitting') : t('login.submit') }}
        </Button>

        <!-- 无密码登录（Passkey）：仅在浏览器支持 WebAuthn 时展示 -->
        <template v-if="passkeySupported">
          <div class="flex items-center gap-3">
            <span class="h-px flex-1 bg-border" />
            <span class="text-xs text-muted-foreground">{{ t('login.or') }}</span>
            <span class="h-px flex-1 bg-border" />
          </div>
          <Button
            variant="outline"
            class="w-full gap-2"
            :disabled="passkeyBusy"
            @click="loginPasskey"
          >
            <Fingerprint :size="16" />
            {{ passkeyBusy ? t('login.passkeyVerifying') : t('login.passkey') }}
          </Button>
        </template>
      </template>

      <!-- 第二步：两步验证码（或备份码） -->
      <template v-else>
        <div class="flex flex-col items-center gap-1 text-center">
          <KeyRound :size="20" class="text-muted-foreground" />
          <p class="text-sm font-medium">{{ t('login.mfaTitle') }}</p>
          <p class="text-xs text-muted-foreground">
            {{ t('login.mfaHint') }}
          </p>
        </div>
        <div class="space-y-2">
          <Label>{{ t('login.mfaCode') }}</Label>
          <Input
            ref="codeInput"
            v-model="mfaCode"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            :placeholder="t('login.mfaCodePlaceholder')"
            @keydown.enter="submitMfa"
          />
        </div>
        <Button class="w-full" :disabled="busy" @click="submitMfa">
          {{ busy ? t('login.mfaSubmitting') : t('login.mfaSubmit') }}
        </Button>
        <button
          type="button"
          class="w-full text-center text-xs text-muted-foreground hover:underline"
          @click="cancelMfa"
        >
          {{ t('login.mfaBack') }}
        </button>
      </template>

      <p class="text-center text-xs text-muted-foreground">
        {{ t('login.footer') }}
      </p>
    </div>
  </div>
</template>
