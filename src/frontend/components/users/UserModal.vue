<script setup lang="ts">
// 新增/编辑用户弹窗（Phase J）：用户名 + 初始/重置密码 + 角色。
// 编辑态用户名锁定（不可改），密码留空=不改；防锁死由 store 的 saveUser 内判。
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
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

const { t } = useI18n({ useScope: 'global' });

const props = defineProps<{ open: boolean; editing: AdminUser | null }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved'): void }>();

const name = ref('');
const pw = ref('');
const role = ref<Role>('user');
const busy = ref(false);

const isEdit = computed(() => props.editing !== null);
const title = computed(() =>
  props.editing ? t('users.editTitle', { name: props.editing.username }) : t('users.addUser'),
);
const pwHint = computed(() =>
  props.editing
    ? t('users.pwHintEdit')
    : t('users.pwHintCreate'),
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
  if (creating && !trimmed) { toast(t('users.usernameRequired'), 'error'); return; }
  if (creating && !pw.value) { toast(t('users.initialPwRequired'), 'error'); return; }
  busy.value = true;
  try {
    await saveUser(props.editing?.id ?? null, trimmed, pw.value, role.value);
    if (creating) toast(t('users.createdToast', { name: trimmed }), 'success');
    else toast(t('users.updatedToast') + (pw.value ? t('users.updatedPwSuffix') : ''), 'success');
    emit('saved');
    emit('close');
  } catch (e) {
    toast(e instanceof ApiError ? e.message : t('users.saveFailed'), 'error');
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
          {{ t('users.modalDesc') }}
        </DialogDescription>
      </DialogHeader>

      <div class="space-y-4 py-2">
        <div class="space-y-1.5">
          <Label for="user-name">{{ t('users.username') }}</Label>
          <Input
            id="user-name"
            v-model="name"
            :disabled="isEdit"
            :placeholder="t('users.usernamePlaceholder')"
          />
          <p v-if="isEdit" class="text-xs text-muted-foreground">{{ t('users.usernameLocked') }}</p>
        </div>

        <div class="space-y-1.5">
          <Label for="user-pw">{{ isEdit ? t('users.resetPw') : t('users.initialPw') }}</Label>
          <Input id="user-pw" v-model="pw" type="password" placeholder="••••••••" />
          <p class="text-xs text-muted-foreground">{{ pwHint }}</p>
        </div>

        <div class="space-y-1.5">
          <Label>{{ t('users.role') }}</Label>
          <Select v-model="role">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">{{ t('users.roleUser') }}</SelectItem>
              <SelectItem value="admin">{{ t('users.roleAdmin') }}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" :disabled="busy" @click="emit('close')">{{ t('common.cancel') }}</Button>
        <Button :disabled="busy" @click="onSubmit">{{ isEdit ? t('common.save') : t('users.create') }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
