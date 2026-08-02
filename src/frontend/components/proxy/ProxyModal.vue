<script setup lang="ts">
// 代理新增/编辑弹窗（Phase F）：名称 / 类型 / 主机 / 端口 / 用户名 / 密码。
// edit 回填原值；改名的级联同步在 store 的 saveProxy 内处理。
import { ref, computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  saveProxy, proxyNameExists, type Proxy, type ProxyType, type ProxyForm,
} from '@/stores/proxies';
import { toast } from '@/composables/useToast';

const { t } = useI18n({ useScope: 'global' });

const props = defineProps<{ open: boolean; editing: Proxy | null }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const name = ref('');
const type = ref<ProxyType>('http');
const host = ref('');
const port = ref('');
const user = ref('');
const pass = ref('');
const errorMsg = ref('');

const isEdit = computed(() => props.editing !== null);
const title = computed(() => (isEdit.value ? t('proxy.editTitle') : t('proxy.addProxy')));

watch(
  () => [props.open, props.editing] as const,
  ([open, p]) => {
    if (!open) return;
    errorMsg.value = '';
    if (p) {
      name.value = p.name;
      type.value = p.type;
      host.value = p.host;
      port.value = String(p.port);
      user.value = p.user || '';
      // 密码明文不回传（后端只给 has_password）；编辑时留空=保留原密码。
      pass.value = '';
    } else {
      name.value = '';
      type.value = 'http';
      host.value = '';
      port.value = '';
      user.value = '';
      pass.value = '';
    }
  },
  { immediate: true },
);

const busy = ref(false);

async function onSubmit() {
  if (busy.value) return;
  const nm = name.value.trim();
  const h = host.value.trim();
  const pt = parseInt(String(port.value), 10);
  if (!nm) { errorMsg.value = t('proxy.errNameRequired'); return; }
  if (!h) { errorMsg.value = t('proxy.errHostRequired'); return; }
  if (!(pt >= 1 && pt <= 65535)) { errorMsg.value = t('proxy.errPortRange'); return; }
  const editingId = props.editing ? props.editing.id : null;
  if (proxyNameExists(nm, editingId)) { errorMsg.value = t('proxy.errDuplicateName'); return; }

  const form: ProxyForm = {
    name: nm, type: type.value, host: h, port: pt,
    user: user.value.trim(), pass: pass.value,
  };
  busy.value = true;
  try {
    await saveProxy(form, editingId);
    toast(editingId === null ? t('proxy.addedToast', { name: nm }) : t('proxy.savedToast', { name: nm }), 'success');
    emit('close');
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : t('proxy.saveFailed');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent class="max-w-[460px]">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ t('proxy.modalDesc') }}</DialogDescription>
      </DialogHeader>

      <div class="space-y-5">
        <div class="space-y-1.5">
          <Label>{{ t('proxy.name') }}</Label>
          <Input v-model="name" :placeholder="t('proxy.namePlaceholder')" />
        </div>
        <div class="space-y-1.5">
          <Label>{{ t('proxy.type') }}</Label>
          <Select v-model="type">
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="http">HTTP</SelectItem>
              <SelectItem value="https">HTTPS</SelectItem>
              <SelectItem value="socks5">SOCKS5</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div class="flex flex-wrap gap-3">
          <div class="min-w-0 flex-1 space-y-1.5">
            <Label>{{ t('proxy.host') }}</Label>
            <Input v-model="host" placeholder="127.0.0.1" />
          </div>
          <div class="w-28 space-y-1.5">
            <Label>{{ t('proxy.port') }}</Label>
            <Input v-model="port" type="number" min="1" max="65535" placeholder="7890" />
          </div>
        </div>
        <div class="space-y-1.5">
          <Label>{{ t('proxy.username') }}</Label>
          <Input v-model="user" autocomplete="off" :placeholder="t('proxy.authPlaceholder')" />
        </div>
        <div class="space-y-1.5">
          <Label>{{ t('proxy.password') }}</Label>
          <Input v-model="pass" type="password" autocomplete="new-password" :placeholder="t('proxy.authPlaceholder')" />
        </div>

        <p v-if="errorMsg" class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {{ errorMsg }}
        </p>

        <div class="flex justify-end gap-2">
          <Button variant="outline" @click="emit('close')">{{ t('common.cancel') }}</Button>
          <Button @click="onSubmit">{{ t('common.save') }}</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
