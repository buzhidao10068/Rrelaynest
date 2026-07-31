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

const agreed = ref(false);
const busy = ref(false);

// 同意并继续：写服务端后 App 反应式渲染主面板（无需在此手动切视图）。
async function accept() {
  if (busy.value || !agreed.value) return;
  busy.value = true;
  try {
    await acceptDisclaimer();
  } catch (e) {
    toast(e instanceof Error ? e.message : '保存失败，请重试', 'error');
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
            <CardTitle class="text-xl">使用前须知 · 免责声明</CardTitle>
            <CardDescription>请阅读并同意后进入使用</CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent class="space-y-5 text-sm leading-relaxed text-muted-foreground">
        <section class="space-y-2">
          <h3 class="font-medium text-foreground">一、封禁风险</h3>
          <p>
            本项目的部分功能（如每日自动签到、余额/额度抓取、活跃度探测等）会以<span
              class="font-medium text-foreground"
            >自动化方式</span>访问上游中转站（new-api 等服务）。这些行为<span
              class="font-medium text-foreground"
            >可能触发上游的风控策略，导致你的账号被限制或封禁</span>。是否启用相关功能、以及由此产生的一切后果，均由你自行评估与承担，<span
              class="font-medium text-foreground"
            >与本项目及其作者无关</span>。
          </p>
        </section>
        <section class="space-y-2">
          <h3 class="font-medium text-foreground">二、AI 创作声明</h3>
          <p>
            本项目<span class="font-medium text-foreground">完全由 AI 创作</span>，可能存在各类错误、缺陷或考虑不周之处，<span
              class="font-medium text-foreground"
            >不对其正确性、稳定性或适用性作任何保证</span>。请在充分理解代码与风险的前提下自行使用。
          </p>
        </section>

        <label class="flex cursor-pointer items-start gap-2 border-t border-border pt-4 text-foreground">
          <Checkbox v-model="agreed" class="mt-0.5" />
          <span>我已阅读并理解上述风险，自愿使用本项目并自行承担全部后果。</span>
        </label>
      </CardContent>

      <CardFooter class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" :disabled="busy" @click="declineAndLogout"> 不同意，退出登录 </Button>
        <Button :disabled="!agreed || busy" @click="accept">
          {{ busy ? '处理中…' : '同意并继续' }}
        </Button>
      </CardFooter>
    </Card>
  </div>
</template>
