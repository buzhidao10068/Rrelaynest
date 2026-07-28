<script setup lang="ts">
// 代理新增/编辑弹窗（Phase F）：名称 / 类型 / 主机 / 端口 / 用户名 / 密码。
// edit 回填原值；改名的级联同步在 store 的 saveProxy 内处理。
import { ref, computed, watch } from 'vue';
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
const title = computed(() => (isEdit.value ? '编辑代理' : '新增代理'));

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
  if (!nm) { errorMsg.value = '请填写代理名称'; return; }
  if (!h) { errorMsg.value = '请填写主机地址'; return; }
  if (!(pt >= 1 && pt <= 65535)) { errorMsg.value = '端口需为 1–65535'; return; }
  const editingId = props.editing ? props.editing.id : null;
  if (proxyNameExists(nm, editingId)) { errorMsg.value = '已存在同名代理'; return; }

  const form: ProxyForm = {
    name: nm, type: type.value, host: h, port: pt,
    user: user.value.trim(), pass: pass.value,
  };
  busy.value = true;
  try {
    await saveProxy(form, editingId);
    toast(editingId === null ? `已新增「${nm}」` : `已保存「${nm}」`, 'success');
    emit('close');
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : '保存失败';
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
        <DialogDescription>配置一个出站代理；启用后爬取/签到经此转发</DialogDescription>
      </DialogHeader>

      <div class="space-y-5">
        <div class="space-y-1.5">
          <Label>代理名称</Label>
          <Input v-model="name" placeholder="如：本地-Clash" />
        </div>
        <div class="space-y-1.5">
          <Label>类型</Label>
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
            <Label>主机地址</Label>
            <Input v-model="host" placeholder="127.0.0.1" />
          </div>
          <div class="w-28 space-y-1.5">
            <Label>端口</Label>
            <Input v-model="port" type="number" min="1" max="65535" placeholder="7890" />
          </div>
        </div>
        <div class="space-y-1.5">
          <Label>用户名（选填）</Label>
          <Input v-model="user" autocomplete="off" placeholder="留空表示无需认证" />
        </div>
        <div class="space-y-1.5">
          <Label>密码（选填）</Label>
          <Input v-model="pass" type="password" autocomplete="new-password" placeholder="留空表示无需认证" />
        </div>

        <p v-if="errorMsg" class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {{ errorMsg }}
        </p>

        <div class="flex justify-end gap-2">
          <Button variant="outline" @click="emit('close')">取消</Button>
          <Button @click="onSubmit">保存</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
