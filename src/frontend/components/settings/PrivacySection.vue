<script setup lang="ts">
// 协作与隐私分区（仅 admin 可见）：跨用户只读的条款解锁。
// 默认关闭；须先读条款并勾选同意才能开启。关闭即撤销（对应后端 admin_global_view_ack）。
// 唯一事实来源：users.globalViewAck。
import { ref, computed, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { Eye } from 'lucide-vue-next';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { users, setGlobalViewAck, loadUsers } from '@/stores/users';
import { ApiError } from '@/api';
import { toast } from '@/composables/useToast';

const { t } = useI18n({ useScope: 'global' });

// 进入分区先拉一次用户表 + ack（admin 可能直接进设置页而未经用户管理页）。
onMounted(() => {
  loadUsers().catch((e) => toast(e instanceof ApiError ? e.message : t('settings.privacy.loadFailed'), 'error'));
});

// 勾选「我已阅读并同意」：解锁后强制勾上且禁用（撤销时先关开关）。
const agreeLocal = ref(false);
const agreed = computed({
  get: () => users.globalViewAck || agreeLocal.value,
  set: (v: boolean) => { agreeLocal.value = v; },
});

// 开关：开启要求已勾选同意；关闭直接撤销。异步写后端 settings，失败提示。
const ackOn = computed({
  get: () => users.globalViewAck,
  set: (v: boolean) => {
    if (v) {
      if (!agreeLocal.value && !users.globalViewAck) {
        toast(t('settings.privacy.needAgree'), 'error');
        return;
      }
      setGlobalViewAck(true)
        .then(() => toast(t('settings.privacy.unlockedToast'), 'success'))
        .catch((e) => toast(e instanceof ApiError ? e.message : t('settings.privacy.unlockFailed'), 'error'));
    } else {
      setGlobalViewAck(false)
        .then(() => {
          agreeLocal.value = false;
          toast(t('settings.privacy.revokedToast'), 'success');
        })
        .catch((e) => toast(e instanceof ApiError ? e.message : t('settings.privacy.revokeFailed'), 'error'));
    }
  },
});

const statusText = computed(() => (users.globalViewAck ? t('settings.privacy.unlocked') : t('settings.privacy.locked')));
const statusClass = computed(() =>
  users.globalViewAck
    ? 'text-green-600 dark:text-green-400'
    : 'text-muted-foreground',
);
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-base font-semibold">{{ t('settings.privacy.title') }}</h3>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('settings.privacy.desc') }}</p>
    </div>

    <!-- 条款卡：说明 + 滚动阅读区 + 勾选同意 + 开关 -->
    <div class="rounded-lg border border-border p-5">
      <div class="flex items-start gap-3">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Eye :size="18" />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p class="text-sm font-medium">{{ t('settings.privacy.viewOthersTitle') }}</p>
            <span
              class="rounded-full px-2 py-0.5 text-xs font-medium"
              :class="statusClass"
            >{{ statusText }}</span>
          </div>
          <p class="mt-1 text-xs text-muted-foreground">
            <i18n-t keypath="settings.privacy.viewOthersDesc" tag="span" scope="global">
              <template #readonly><b>{{ t('settings.privacy.readonly') }}</b></template>
            </i18n-t>
          </p>
        </div>
      </div>

      <!-- 条款正文：限高可滚动 -->
      <div class="mt-4 max-h-44 overflow-y-auto rounded-md border border-border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
        <p class="font-medium text-foreground">{{ t('settings.privacy.termsTitle') }}</p>
        <p class="mt-2">{{ t('settings.privacy.term1') }}</p>
        <p class="mt-2">{{ t('settings.privacy.term2') }}</p>
        <p class="mt-2">{{ t('settings.privacy.term3') }}</p>
        <p class="mt-2">{{ t('settings.privacy.term4') }}</p>
        <p class="mt-2">{{ t('settings.privacy.term5') }}</p>
      </div>

      <!-- 勾选同意：解锁后禁用（撤销先关开关） -->
      <label class="mt-4 flex cursor-pointer items-start gap-2 text-sm">
        <Checkbox
          v-model="agreed"
          :disabled="users.globalViewAck"
          class="mt-0.5"
        />
        <span>{{ t('settings.privacy.agreeLabel') }}</span>
      </label>

      <!-- 开关行 -->
      <div class="mt-4 flex items-center gap-4 border-t border-border pt-4">
        <Switch v-model="ackOn" />
        <div>
          <p class="text-sm font-medium">{{ t('settings.privacy.enableTitle') }}</p>
          <p class="text-xs text-muted-foreground">{{ t('settings.privacy.enableDesc') }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
