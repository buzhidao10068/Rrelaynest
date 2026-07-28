<script setup lang="ts">
// 登录页。真实端：POST /api/login {username, password}，成功后写会话并进主页。
import { ref } from 'vue';
import { ShieldCheck } from 'lucide-vue-next';
import { showView } from '@/stores/ui';
import { setSession } from '@/stores/users';
import { api } from '@/api';
import { toast } from '@/composables/useToast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const username = ref('');
const password = ref('');
const busy = ref(false);

async function login() {
  if (busy.value) return;
  if (!username.value || !password.value) {
    toast('请输入用户名和密码', 'error');
    return;
  }
  busy.value = true;
  try {
    await api.post('/api/login', { username: username.value, password: password.value });
    // 登录成功后回查会话拿角色/用户名（后端权威）。
    const s = await api.get<{ authenticated: boolean; username?: string; role?: string }>('/api/session');
    setSession(s.username ?? username.value, s.role === 'admin' ? 'admin' : 'user');
    password.value = '';
    showView('dashboard');
  } catch (e) {
    toast(e instanceof Error ? e.message : '登录失败', 'error');
  } finally {
    busy.value = false;
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
      <p class="text-center text-xs text-muted-foreground">
        仅限授权用户访问 · Rrelaynest 中转站管理系统
      </p>
    </div>
  </div>
</template>
