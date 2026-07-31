<script setup lang="ts">
// 登录页。真实端：POST /api/login {username, password}。
// 开了两步验证的用户：第一步不发会话，改返 { mfaRequired, ticket }；前端切到第二步，
// 凭 ticket + 6 位 TOTP 码（或备份码）走 POST /api/login/totp 换会话。见 shared/routes.ts。
import { ref, nextTick, onMounted } from 'vue';
import { ShieldCheck, KeyRound, Fingerprint } from 'lucide-vue-next';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { showView } from '@/stores/ui';
import { setSession } from '@/stores/users';
import { loadDisclaimer } from '@/stores/disclaimer';
import { api } from '@/api';
import { toast } from '@/composables/useToast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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

// 会话就绪后回查角色/用户名并进主页（两条登录路径共用）。
async function finishLogin() {
  const s = await api.get<{ authenticated: boolean; id?: number; username?: string; role?: string }>('/api/session');
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
    toast('请输入用户名和密码', 'error');
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
    toast(e instanceof Error ? e.message : '登录失败', 'error');
  } finally {
    busy.value = false;
  }
}

async function submitMfa() {
  if (busy.value || !mfaTicket.value) return;
  const code = mfaCode.value.trim();
  if (!code) {
    toast('请输入验证码', 'error');
    return;
  }
  busy.value = true;
  try {
    await api.post('/api/login/totp', { ticket: mfaTicket.value, code });
    await finishLogin();
  } catch (e) {
    toast(e instanceof Error ? e.message : '验证失败', 'error');
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
    toast(e instanceof Error ? e.message : 'Passkey 登录失败', 'error');
  } finally {
    passkeyBusy.value = false;
  }
}
</script>

<template>
  <div class="flex min-h-screen items-center justify-center p-6">
    <div class="w-[400px] space-y-6 rounded-lg border border-border bg-card p-8 shadow-sm">
      <div class="flex flex-col items-center gap-2">
        <div class="flex h-11 w-11 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ShieldCheck :size="22" />
        </div>
        <h1 class="text-2xl font-semibold tracking-tight">Rrelaynest</h1>
        <p class="text-sm text-muted-foreground">管理面板登录</p>
      </div>
      <!-- 第一步：用户名 + 密码 -->
      <template v-if="!mfaTicket">
        <div class="space-y-2">
          <Label>用户名</Label>
          <Input
            v-model="username"
            type="text"
            placeholder="请输入用户名"
            autocomplete="username"
            @keydown.enter="login"
          />
        </div>
        <div class="space-y-2">
          <Label>密码</Label>
          <Input
            v-model="password"
            type="password"
            placeholder="请输入密码"
            autocomplete="current-password"
            @keydown.enter="login"
          />
        </div>
        <Button class="w-full" :disabled="busy" @click="login">
          {{ busy ? '登录中…' : '登录' }}
        </Button>

        <!-- 无密码登录（Passkey）：仅在浏览器支持 WebAuthn 时展示 -->
        <template v-if="passkeySupported">
          <div class="flex items-center gap-3">
            <span class="h-px flex-1 bg-border" />
            <span class="text-xs text-muted-foreground">或</span>
            <span class="h-px flex-1 bg-border" />
          </div>
          <Button
            variant="outline"
            class="w-full gap-2"
            :disabled="passkeyBusy"
            @click="loginPasskey"
          >
            <Fingerprint :size="16" />
            {{ passkeyBusy ? '验证中…' : '使用 Passkey 登录' }}
          </Button>
        </template>
      </template>

      <!-- 第二步：两步验证码（或备份码） -->
      <template v-else>
        <div class="flex flex-col items-center gap-1 text-center">
          <KeyRound :size="20" class="text-muted-foreground" />
          <p class="text-sm font-medium">两步验证</p>
          <p class="text-xs text-muted-foreground">
            打开验证器 App 输入 6 位动态码；也可输入一个备份码。
          </p>
        </div>
        <div class="space-y-2">
          <Label>验证码</Label>
          <Input
            ref="codeInput"
            v-model="mfaCode"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="6 位验证码或备份码"
            @keydown.enter="submitMfa"
          />
        </div>
        <Button class="w-full" :disabled="busy" @click="submitMfa">
          {{ busy ? '验证中…' : '验证并登录' }}
        </Button>
        <button
          type="button"
          class="w-full text-center text-xs text-muted-foreground hover:underline"
          @click="cancelMfa"
        >
          返回上一步
        </button>
      </template>

      <p class="text-center text-xs text-muted-foreground">
        仅限授权用户访问 · Rrelaynest 中转站管理系统
      </p>
    </div>
  </div>
</template>
