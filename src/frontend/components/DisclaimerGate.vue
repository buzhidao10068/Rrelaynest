<script setup lang="ts">
// 首次使用免责声明门禁（07-31）：登录成功后、进主面板前全屏拦截（per-user，一次性）。
// 勾选同意 → acceptDisclaimer() 写服务端 disclaimer_accepted → App 依 disclaimerState 反应式放行。
// 不同意 → 标准登出回登录页，避免用户被困。
import { ref } from 'vue';
import { ShieldAlert } from 'lucide-vue-next';
import { acceptDisclaimer } from '@/stores/disclaimer';
import { clearSession } from '@/stores/users';
import { showView } from '@/stores/ui';
import { api } from '@/api';
import { toast } from '@/composables/useToast';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '@/components/ui/card';
import { useI18n } from 'vue-i18n';

const { t } = useI18n({ useScope: 'global' });

const agreed = ref(false);
const busy = ref(false);

// 同意并继续：写服务端后 App 反应式渲染主面板（无需在此手动切视图）。
async function accept() {
  if (busy.value || !agreed.value) return;
  busy.value = true;
  try {
    await acceptDisclaimer();
  } catch (e) {
    toast(e instanceof Error ? e.message : t('disclaimer.saveFailed'), 'error');
  } finally {
    busy.value = false;
  }
}

// 不同意 → 登出并回登录页（登出接口失败也照常清理本地会话）。
async function declineAndLogout() {
  if (busy.value) return;
  busy.value = true;
  try {
    await api.post('/api/logout');
  } catch {
    /* 忽略：cookie 可能已失效 */
  }
  clearSession();
  showView('login');
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background/95 p-4 backdrop-blur-sm"
  >
    <Card class="my-8 w-full max-w-2xl">
      <CardHeader>
        <div class="flex items-center gap-3">
          <div
            class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive"
          >
            <ShieldAlert :size="22" />
          </div>
          <div>
            <CardTitle class="text-xl">{{ t('disclaimer.title') }}</CardTitle>
            <CardDescription>{{ t('disclaimer.subtitle') }}</CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent class="space-y-5 text-sm leading-relaxed text-muted-foreground">
        <section class="space-y-2">
          <h3 class="font-medium text-foreground">{{ t('disclaimer.banRiskTitle') }}</h3>
          <i18n-t keypath="disclaimer.banRiskBody" tag="p">
            <template #auto><span class="font-medium text-foreground">{{ t('disclaimer.banRiskAuto') }}</span></template>
            <template #risk><span class="font-medium text-foreground">{{ t('disclaimer.banRiskRisk') }}</span></template>
            <template #disclaim><span class="font-medium text-foreground">{{ t('disclaimer.banRiskDisclaim') }}</span></template>
          </i18n-t>
        </section>
        <section class="space-y-2">
          <h3 class="font-medium text-foreground">{{ t('disclaimer.aiTitle') }}</h3>
          <i18n-t keypath="disclaimer.aiBody" tag="p">
            <template #byAi><span class="font-medium text-foreground">{{ t('disclaimer.aiByAi') }}</span></template>
            <template #noGuarantee><span class="font-medium text-foreground">{{ t('disclaimer.aiNoGuarantee') }}</span></template>
          </i18n-t>
        </section>

        <label class="flex cursor-pointer items-start gap-2 border-t border-border pt-4 text-foreground">
          <Checkbox v-model="agreed" class="mt-0.5" />
          <span>{{ t('disclaimer.agree') }}</span>
        </label>
      </CardContent>

      <CardFooter class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" :disabled="busy" @click="declineAndLogout">{{ t('disclaimer.declineLogout') }}</Button>
        <Button :disabled="!agreed || busy" @click="accept">
          {{ busy ? t('disclaimer.processing') : t('disclaimer.agreeContinue') }}
        </Button>
      </CardFooter>
    </Card>
  </div>
</template>
