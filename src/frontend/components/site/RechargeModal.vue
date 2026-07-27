<script setup lang="ts">
// 充值弹窗（Phase E）：充值人民币 → 到账站点货币 + 日期。
// 确认后 rechargeSite 更新该站汇率并把到账额累加到余额。
import { ref, computed, watch, nextTick } from 'vue';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { rechargeSite, curSign, deriveRecharge, type Site } from '@/stores/sites';
import { toast } from '@/composables/useToast';

const props = defineProps<{ open: boolean; site: Site | null }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const rmb = ref('');
const amount = ref('');
const date = ref('');
const errorMsg = ref('');

const curLabel = computed(() => props.site?.cur || 'USD');
const desc = computed(() =>
  props.site ? `为「${props.site.name}」记录一次充值` : '记录一次充值：充多少人民币、到账多少站点货币',
);

const ratioHint = computed(() => {
  const r = parseFloat(rmb.value);
  const a = parseFloat(amount.value);
  if (r > 0 && a > 0) {
    return `本次汇率：1 ${curLabel.value} ≈ ¥${(r / a).toFixed(2)}；确认后到账额度累加到余额，并更新该站汇率。`;
  }
  return '本次充值将更新该站汇率，并把到账额度累加到余额。';
});

function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    if (props.site) deriveRecharge(props.site);
    rmb.value = '';
    amount.value = '';
    date.value = todayStr();
    errorMsg.value = '';
    nextTick(() => document.getElementById('recharge-rmb')?.focus());
  },
);

function onConfirm() {
  if (!props.site) { emit('close'); return; }
  const r = parseFloat(String(rmb.value).trim());
  const a = parseFloat(String(amount.value).trim());
  if (!(r > 0)) { errorMsg.value = '请填写充值金额（大于 0 的人民币数）'; return; }
  if (!(a > 0)) { errorMsg.value = '请填写到账额度（大于 0 的站点货币数）'; return; }
  const nm = props.site.name;
  const s = props.site;
  if (rechargeSite(nm, r, a)) {
    toast(
      `「${nm}」已充值 ¥${r.toFixed(2)}，到账 ${curSign(s.cur)}${a.toFixed(2)}，余额 ${curSign(s.cur)}${(s.balNum ?? 0).toFixed(2)}`,
      'success',
    );
  }
  emit('close');
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent class="max-w-[420px]">
      <DialogHeader>
        <DialogTitle>充值</DialogTitle>
        <DialogDescription>{{ desc }}</DialogDescription>
      </DialogHeader>

      <div class="space-y-1.5">
        <Label>充值金额（人民币）</Label>
        <div class="flex items-center gap-2">
          <span class="shrink-0 text-sm text-muted-foreground">¥</span>
          <Input
            id="recharge-rmb"
            v-model="rmb"
            type="number" min="0" step="0.01" placeholder="0.00"
          />
        </div>
      </div>

      <div class="space-y-1.5">
        <Label>到账额度（站点货币）</Label>
        <div class="flex items-center gap-2">
          <Input
            v-model="amount"
            type="number" min="0" step="0.0001" placeholder="0.00"
          />
          <span class="shrink-0 text-sm text-muted-foreground">{{ curLabel }}</span>
        </div>
        <p class="text-xs text-muted-foreground">{{ ratioHint }}</p>
      </div>

      <div class="space-y-1.5">
        <Label>充值日期</Label>
        <Input v-model="date" type="date" />
      </div>

      <p v-if="errorMsg" class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
        {{ errorMsg }}
      </p>

      <div class="flex justify-end gap-2">
        <Button variant="outline" @click="emit('close')">取消</Button>
        <Button @click="onConfirm">确认充值</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
