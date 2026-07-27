<script setup lang="ts">
// 全局顶栏：shadcn-vue 官方 dashboard 范式——SidebarTrigger(即汉堡钮，与侧栏同源) +
// 竖向 Separator + 页面标题。所有视图共用，取代各页手搓的 header，保证与 sidebar 风格统一。
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';

defineProps<{ title: string }>();
</script>

<template>
  <header
    class="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60"
  >
    <SidebarTrigger class="-ml-1" />
    <Separator orientation="vertical" class="mr-1 h-4" />
    <h1 class="text-base font-semibold">{{ title }}</h1>
    <div class="ml-auto flex items-center gap-2">
      <slot name="actions" />
    </div>
  </header>
</template>
