<script setup lang="ts">
// 新增/编辑用户弹窗（Phase J）：用户名 + 初始/重置密码 + 角色。
// 编辑态用户名锁定（不可改），密码留空=不改；防锁死由 store 的 saveUser 内判。
import { ref, computed, watch } from 'vue';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { saveUser, type AdminUser, type Role } from '@/stores/users';
import { ApiError } from '@/api';
import { toast } from '@/composables/useToast';

const props = defineProps<{ open: boolean; editing: AdminUser | null }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>();

const name = ref('');
const pw = ref('');
const role = ref<Role>('user');
const busy = ref(false);

const isEdit = computed(() => props.editing !== null);
const title = computed(() =>
  props.editing ? `编辑用户 · ${props.editing.username}` : '新增用户',
);
const pwHint = computed(() =>
  props.editing
    ? '留空表示不改密码；填写则重置（其已登录会话将失效）。'
    : '将作为该用户的初始登录密码。',
);

const openProxy = computed({
  get: () => props.open,
  set: (v: boolean) => { if (!v) emit('close'); },
});

watch(
  () => [props.open, props.editing] as const,
  ([open, u]) => {
    if (!open) return;
    if (u) {
      name.value = u.username;
      role.value = u.role;
    } else {
      name.value = '';
      role.value = 'user';
    }
    pw.value = '';
  },
  { immediate: true },
);

async function onSubmit() {
  const trimmed = name.value.trim();
  const creating = props.editing === null;
  // 本地即时校验（后端仍会 400/409 兜底）。
  if (creating && !trimmed) { toast('用户名必填', 'error'); return; }
  if (creating && !pw.value) { toast('初始密码必填', 'error'); return; }
  busy.value = true;
  try {
    await saveUser(props.editing?.id ?? null, trimmed, pw.value, role.value);
    if (creating) toast(`已创建用户 ${trimmed}`, 'success');
    else toast(`已更新用户${pw.value ? '（密码已重置，旧会话失效）' : ''}`, 'success');
    emit('saved');
    emit('close');
  } catch (e) {
    toast(e instanceof ApiError ? e.message : '保存失败', 'error');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="openProxy">
    <DialogContent class="sm:max-w-[420px]">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>
          邀请制：由管理员手动开号。每个用户的站点、代理、设置完全隔离。
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <div class="space-y-1.5">
          <Label for="user-name">用户名</Label>
          <Input
            id="user-name"
            v-model="name"
            :disabled="isEdit"
            placeholder="登录用户名"
          />
          <p v-if="isEdit" class="text-xs text-muted-foreground">用户名创建后不可修改。</p>
        </div>

        <div class="space-y-1.5">
          <Label for="user-pw">{{ isEdit ? '重置密码' : '初始密码' }}</Label>
          <Input id="user-pw" v-model="pw" type="password" placeholder="••••••••" />
          <p class="text-xs text-muted-foreground">{{ pwHint }}</p>
        </div>

        <div class="space-y-1.5">
          <Label>角色</Label>
          <Select v-model="role">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">用户</SelectItem>
              <SelectItem value="admin">管理员</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="busy" @click="emit('close')">取消</Button>
        <Button :disabled="busy" @click="onSubmit">{{ isEdit ? '保存' : '创建' }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
