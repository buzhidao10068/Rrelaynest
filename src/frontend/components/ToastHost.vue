<script setup lang="ts">
// Toast 渲染宿主：固定右下角，渲染 toast 队列。主题自适应。
import { Check, CircleX, Info } from 'lucide-vue-next';
import { useToastState, type ToastKind } from '@/composables/useToast';

const state = useToastState();

const ringClass: Record<ToastKind, string> = {
  success: 'text-green-500',
  error: 'text-red-500',
  info: 'text-muted-foreground',
};
</script>

<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-[200] flex flex-col items-end gap-2">
    <TransitionGroup
      enter-active-class="transition-all duration-200"
      enter-from-class="translate-y-2 opacity-0"
      leave-active-class="transition-all duration-200"
      leave-to-class="translate-y-2 opacity-0"
    >
      <div
        v-for="t in state.items"
        :key="t.id"
        class="pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm shadow-lg"
      >
        <Check v-if="t.kind === 'success'" :size="16" class="shrink-0" :class="ringClass.success" />
        <CircleX v-else-if="t.kind === 'error'" :size="16" class="shrink-0" :class="ringClass.error" />
        <Info v-else :size="16" class="shrink-0" :class="ringClass.info" />
        <span>{{ t.msg }}</span>
      </div>
    </TransitionGroup>
  </div>
</template>
