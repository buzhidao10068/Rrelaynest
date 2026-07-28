<script setup lang="ts">
// 安全分区：修改密码=真接后端 POST /api/account/password（改完后端会重签发会话 cookie，本设备保持登录，
// 别处旧会话被 session_version 吊销）。两步验证 / Passkey / 登出所有设备后端未实现，保持占位（notImpl）。
import { ref, computed } from 'vue';
import { Lock, Fingerprint, Smartphone } from 'lucide-vue-next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/api';
import { toast } from '@/composables/useToast';

function notImpl(msg: string) {
  toast(msg, 'info');
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
    toast('新密码至少 8 位', 'error');
    return;
  }
  if (next.value !== confirm.value) {
    toast('两次输入的新密码不一致', 'error');
    return;
  }
  if (next.value === current.value) {
    toast('新密码不能与当前密码相同', 'error');
    return;
  }
  busy.value = true;
  try {
    await api.post('/api/account/password', { current: current.value, next: next.value });
    current.value = '';
    next.value = '';
    confirm.value = '';
    toast('密码已更新，其他设备的登录会话已失效', 'success');
  } catch (e) {
    toast(e instanceof ApiError ? e.message : '密码更新失败', 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-base font-semibold">安全</h3>
      <p class="mt-1 text-sm text-muted-foreground">登录密码、两步验证与登录方式。</p>
    </div>

    <!-- 修改密码 -->
    <div class="rounded-lg border border-border p-5">
      <p class="text-sm font-medium">修改密码</p>
      <div class="mt-4 space-y-3">
        <div class="flex items-center gap-4">
          <Label class="w-24 shrink-0 text-right text-muted-foreground">当前密码</Label>
          <Input v-model="current" type="password" placeholder="输入当前密码" class="w-80" autocomplete="current-password" />
        </div>
        <div class="flex items-center gap-4">
          <Label class="w-24 shrink-0 text-right text-muted-foreground">新密码</Label>
          <Input v-model="next" type="password" placeholder="至少 8 位" class="w-80" autocomplete="new-password" />
        </div>
        <div class="flex items-center gap-4">
          <Label class="w-24 shrink-0 text-right text-muted-foreground">确认新密码</Label>
          <Input v-model="confirm" type="password" placeholder="再次输入新密码" class="w-80" autocomplete="new-password" @keyup.enter="changePassword" />
        </div>
        <div class="flex items-center gap-4">
          <span class="w-24 shrink-0" />
          <Button :disabled="!canSubmit" @click="changePassword">{{ busy ? '更新中…' : '更新密码' }}</Button>
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
            <p class="text-sm font-medium">两步验证 (2FA)</p>
            <span class="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">未启用</span>
          </div>
          <p class="mt-1 text-xs text-muted-foreground">
            使用 TOTP 验证器 App（如 Google Authenticator / 1Password）生成动态验证码，登录时二次校验。
          </p>
        </div>
        <Button class="shrink-0" @click="notImpl('演示端未接后端')">启用</Button>
      </div>
    </div>

    <!-- Passkey -->
    <div class="rounded-lg border border-border p-5">
      <div class="flex items-start gap-3">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Fingerprint :size="18" />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p class="text-sm font-medium">Passkey</p>
            <span class="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">1 个已注册</span>
          </div>
          <p class="mt-1 text-xs text-muted-foreground">
            用指纹 / 面容 / 硬件密钥（WebAuthn）免密登录，更安全便捷。
          </p>
        </div>
        <Button variant="outline" class="shrink-0" @click="notImpl('演示端未接后端')">添加 Passkey</Button>
      </div>
      <div class="mt-4 space-y-2 border-t border-border pt-4">
        <div class="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent">
          <span class="flex items-center gap-2">
            <Smartphone :size="15" />
            MacBook Pro · Touch ID
          </span>
          <span class="flex items-center gap-3">
            <span class="text-xs text-muted-foreground">3 天前</span>
            <button class="text-xs font-medium text-red-500 hover:underline" @click="notImpl('演示端未接后端')">移除</button>
          </span>
        </div>
      </div>
    </div>

    <!-- 会话 -->
    <div class="rounded-lg border border-border p-5">
      <p class="text-sm font-medium">会话</p>
      <p class="mt-1 text-xs text-muted-foreground">登录会话有效期 7 天（HttpOnly + Secure Cookie）。</p>
      <Button variant="outline" size="sm" class="mt-3" @click="notImpl('演示端未接后端')">登出所有设备</Button>
    </div>
  </div>
</template>
