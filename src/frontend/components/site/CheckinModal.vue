<script setup lang="ts">
// 手动签到弹窗（Phase E）：仅在 checkinSite 返回 'need-amount'（本站未设默认金额）时弹出。
// 填本次到账金额（0 或正数）→ manualCheckin 落账。
import { ref, computed, watch, nextTick } from 'vue';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { sitesState, manualCheckin, type Site } from '@/stores/sites';
import { toast } from '@/composables/useToast';

const props = defineProps<{ open: boolean; site: Site | null }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const amount = ref('');
const errorMsg = ref('');

const curLabel = computed(() => props.site?.cur || 'USD');
const desc = computed(() =>
  props.site ? `「${props.site.name}」本次签到到账金额（该站未设默认金额）` : '填写本次签到到账的金额',
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    amount.value = '';
    errorMsg.value = '';
    // 官方 Input 未转发 ref 到内部 <input>，用 id 聚焦。
    nextTick(() => document.getElementById('checkin-amount')?.focus());
  },
);

function onConfirm() {
  if (!props.site) { emit('close'); return; }
  const raw = String(amount.value).trim();
  const amt = parseFloat(raw);
  if (raw === '' || !(amt >= 0)) {
    errorMsg.value = '请填写本次到账金额（0 或正数）';
    return;
  }
  const nm = props.site.name;
  const r = manualCheckin(nm, amt);
  if (r) {
    toast(`「${nm}」签到成功，到账 ${r.amountText}，余额 ${r.balanceText}`, 'success');
  }
  emit('close');
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent class="max-w-[400px]">
      <DialogHeader>
        <DialogTitle>手动签到</DialogTitle>
        <DialogDescription>{{ desc }}</DialogDescription>
      </DialogHeader>

      <div class="space-y-1.5">
        <Label for="checkin-amount">本次到账金额</Label>
        <div class="flex items-center gap-2">
          <Input
            id="checkin-amount"
            v-model="amount"
            type="number" min="0" step="0.01" placeholder="0.00"
            @keydown.enter="onConfirm"
          />
          <span class="shrink-0 text-sm text-muted-foreground">{{ curLabel }}</span>
        </div>
        <p class="text-xs text-muted-foreground">填 0 或正数；本站未设默认签到金额时，每次都需填写。</p>
      </div>

      <p v-if="errorMsg" class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
        {{ errorMsg }}
      </p>

      <div class="flex justify-end gap-2">
        <Button variant="outline" @click="emit('close')">取消</Button>
        <Button @click="onConfirm">确认签到</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
