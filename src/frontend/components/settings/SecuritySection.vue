<script setup lang="ts">
// 安全分区（mock）：修改密码 + 两步验证 + Passkey + 会话。演示端仅 UI，不落后端。
import { Lock, Fingerprint, Smartphone } from 'lucide-vue-next';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from '@/composables/useToast';

function notImpl(msg: string) {
  toast(msg, 'info');
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
          <Input type="password" placeholder="输入当前密码" class="w-80" />
        </div>
        <div class="flex items-center gap-4">
          <Label class="w-24 shrink-0 text-right text-muted-foreground">新密码</Label>
          <Input type="password" placeholder="输入新密码" class="w-80" />
        </div>
        <div class="flex items-center gap-4">
          <Label class="w-24 shrink-0 text-right text-muted-foreground">确认新密码</Label>
          <Input type="password" placeholder="再次输入新密码" class="w-80" />
        </div>
        <div class="flex items-center gap-4">
          <span class="w-24 shrink-0" />
          <Button @click="notImpl('演示端未接后端，密码未实际更新')">更新密码</Button>
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
