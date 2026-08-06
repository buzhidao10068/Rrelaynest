<script setup lang="ts">
// 服务端配置健康提示条：目前只提示 ENCRYPTION_KEY 格式非法。
// 挂在 App.vue 顶层，登录页与主界面都能看到 —— 让「部署后尽早发现密钥配错」，
// 而不是等到用户填 Access Token 保存时才撞错误。
// 事实来源只有后端 /api/session 下发的 ui.configWarnings，前端不推断（它看不到密钥）。
import { useI18n } from 'vue-i18n';
import { AlertTriangle } from 'lucide-vue-next';
import { encryptionKeyInvalid } from '@/stores/ui';

const { t } = useI18n({ useScope: 'global' });
</script>

<template>
  <div
    v-if="encryptionKeyInvalid"
    role="alert"
    class="flex items-start gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
  >
    <AlertTriangle :size="18" class="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
    <div class="min-w-0">
      <p class="font-medium text-amber-700 dark:text-amber-300">
        {{ t('configWarning.encryptionKeyTitle') }}
      </p>
      <p class="mt-1 text-muted-foreground">
        {{ t('configWarning.encryptionKeyDesc') }}
      </p>
      <p class="mt-1 font-mono text-xs text-muted-foreground">openssl rand -base64 32</p>
    </div>
  </div>
</template>
