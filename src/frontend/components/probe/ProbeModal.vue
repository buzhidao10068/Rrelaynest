<script setup lang="ts">
// 测活词新增/编辑弹窗（Phase G）：单个文本字段。
// edit 回填原文本；改名的级联同步在 store 的 saveProbe 内处理。
import { ref, computed, watch, nextTick } from 'vue';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { saveProbe, probeExists, findProbe } from '@/stores/probes';
import { ApiError } from '@/api';
import { toast } from '@/composables/useToast';
import { useI18n } from 'vue-i18n';

const { t: $t } = useI18n({ useScope: 'global' });

// editing = 被编辑词条的 id（新增时 null）
const props = defineProps<{ open: boolean; editing: number | null }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const text = ref('');
const errorMsg = ref('');
const busy = ref(false);

const isEdit = computed(() => props.editing !== null);
const title = computed(() => (isEdit.value ? $t('probe.editTitle') : $t('probe.addTitle')));

watch(
  () => [props.open, props.editing] as const,
  ([open, editingId]) => {
    if (!open) return;
    errorMsg.value = '';
    busy.value = false;
    text.value = editingId != null ? (findProbe(editingId)?.text ?? '') : '';
    // 官方 Input 未转发 ref 到内部 <input>，用 id 聚焦。
    nextTick(() => document.getElementById('probe-text')?.focus());
  },
  { immediate: true },
);

async function onSubmit() {
  const t = text.value.trim();
  if (!t) { errorMsg.value = $t('probe.textRequired'); return; }
  const editingId = props.editing;
  // 本地即时反馈；后端仍会 409 兜底。
  if (probeExists(t, editingId)) { errorMsg.value = $t('probe.duplicate'); return; }
  busy.value = true;
  try {
    await saveProbe(t, editingId);
    toast(editingId === null ? $t('probe.added', { text: t }) : $t('probe.saved', { text: t }), 'success');
    emit('close');
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? e.message : $t('probe.saveFailed');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent class="max-w-[420px]">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ $t('probe.modalDesc') }}</DialogDescription>
      </DialogHeader>

      <div class="space-y-5">
        <div class="space-y-1.5">
          <Label>{{ $t('probe.probeWord') }}</Label>
          <Input id="probe-text" v-model="text" :disabled="busy" :placeholder="$t('probe.textPlaceholder')" @keyup.enter="onSubmit" />
          <p class="text-xs text-muted-foreground">{{ $t('probe.textHint') }}</p>
        </div>

        <p v-if="errorMsg" class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {{ errorMsg }}
        </p>

        <div class="flex justify-end gap-2">
          <Button variant="outline" :disabled="busy" @click="emit('close')">{{ $t('common.cancel') }}</Button>
          <Button :disabled="busy" @click="onSubmit">{{ busy ? $t('common.saving') : $t('common.save') }}</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
