<script setup lang="ts">
// 登录页。演示端：任意密码回车/点登录即进 dashboard（块7 接 POST /api/login）。
import { ref } from 'vue';
import { ShieldCheck } from 'lucide-vue-next';
import { showView } from '@/stores/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const password = ref('');

function login() {
  showView('dashboard');
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
      <div class="space-y-2">
        <Label>管理员密码</Label>
        <Input
          v-model="password"
          type="password"
          placeholder="请输入管理员密码"
          @keydown.enter="login"
        />
      </div>
      <Button class="w-full" @click="login">登录</Button>
      <p class="text-center text-xs text-muted-foreground">
        仅限授权管理员访问 · Rrelaynest 中转站管理系统
      </p>
    </div>
  </div>
</template>
