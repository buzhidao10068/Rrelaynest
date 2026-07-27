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
import { saveProbe, probeExists } from '@/stores/probes';
import { toast } from '@/composables/useToast';

// editing = 被编辑词条的原始 text（新增时 null）
const props = defineProps<{ open: boolean; editing: string | null }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const text = ref('');
const errorMsg = ref('');

const isEdit = computed(() => props.editing !== null);
const title = computed(() => (isEdit.value ? '编辑测活词' : '新增测活词'));

watch(
  () => [props.open, props.editing] as const,
  ([open, editingText]) => {
    if (!open) return;
    errorMsg.value = '';
    text.value = editingText ?? '';
    // 官方 Input 未转发 ref 到内部 <input>，用 id 聚焦。
    nextTick(() => document.getElementById('probe-text')?.focus());
  },
  { immediate: true },
);

function onSubmit() {
  const t = text.value.trim();
  if (!t) { errorMsg.value = '请填写测活词内容'; return; }
  const editingText = props.editing;
  if (probeExists(t, editingText)) { errorMsg.value = '已存在相同的测活词'; return; }
  saveProbe(t, editingText);
  toast(editingText === null ? `已新增「${t}」` : `已保存「${t}」`, 'success');
  emit('close');
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent class="max-w-[420px]">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>渠道测试时发给模型的话，模型正常回复即判为存活。</DialogDescription>
      </DialogHeader>

      <div class="space-y-5">
        <div class="space-y-1.5">
          <Label>测活词</Label>
          <Input id="probe-text" v-model="text" placeholder="如：hi" @keyup.enter="onSubmit" />
          <p class="text-xs text-muted-foreground">发给模型的一句话，如「hi」「你好」「ping」。</p>
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
