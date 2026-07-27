<script setup lang="ts">
// 协作与隐私分区（仅 admin 可见）：跨用户只读的条款解锁。
// 默认关闭；须先读条款并勾选同意才能开启。关闭即撤销（对应后端 admin_global_view_ack）。
// 唯一事实来源：users.globalViewAck。
import { ref, computed } from 'vue';
import { Eye } from 'lucide-vue-next';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { users, setGlobalViewAck } from '@/stores/users';
import { toast } from '@/composables/useToast';

// 勾选「我已阅读并同意」：解锁后强制勾上且禁用（撤销时先关开关）。
const agreeLocal = ref(false);
const agreed = computed({
  get: () => users.globalViewAck || agreeLocal.value,
  set: (v: boolean) => { agreeLocal.value = v; },
});

// 开关：开启要求已勾选同意；关闭直接撤销。
const ackOn = computed({
  get: () => users.globalViewAck,
  set: (v: boolean) => {
    if (v) {
      if (!agreeLocal.value && !users.globalViewAck) {
        toast('请先阅读条款并勾选「我已阅读并同意」', 'error');
        return;
      }
      setGlobalViewAck(true);
      toast('已解锁：可只读查看用户站点', 'success');
    } else {
      setGlobalViewAck(false);
      agreeLocal.value = false;
      toast('已撤销：恢复隐藏他人站点', 'success');
    }
  },
});

const statusText = computed(() => (users.globalViewAck ? '已解锁' : '未解锁'));
const statusClass = computed(() =>
  users.globalViewAck
    ? 'text-green-600 dark:text-green-400'
    : 'text-muted-foreground',
);
</script>

<template>
  <div class="space-y-6">
    <div>
      <h3 class="text-base font-semibold">协作与隐私</h3>
      <p class="mt-1 text-sm text-muted-foreground">管理员查看其他用户数据的权限开关。默认关闭。</p>
    </div>

    <!-- 条款卡：说明 + 滚动阅读区 + 勾选同意 + 开关 -->
    <div class="rounded-lg border border-border p-5">
      <div class="flex items-start gap-3">
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Eye :size="18" />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p class="text-sm font-medium">查看他人站点数据</p>
            <span
              class="rounded-full px-2 py-0.5 text-xs font-medium"
              :class="statusClass"
            >{{ statusText }}</span>
          </div>
          <p class="mt-1 text-xs text-muted-foreground">
            开启后可在「用户管理」里<b>只读</b>查看任一用户的站点（余额、签到状态等，token 已隐藏）。仅用于管理排障，不能编辑、删除、爬取或签到。
          </p>
        </div>
      </div>

      <!-- 条款正文：限高可滚动 -->
      <div class="mt-4 max-h-44 overflow-y-auto rounded-md border border-border bg-muted/30 p-4 text-xs leading-relaxed text-muted-foreground">
        <p class="font-medium text-foreground">使用条款</p>
        <p class="mt-2">1. 本功能允许管理员越过数据隔离，只读查看其他用户的站点数据，仅限用于故障排查、合规审计与必要的运维支持。</p>
        <p class="mt-2">2. 你不得将查看到的他人数据用于任何未经授权的目的，包括但不限于转发、公开、商业利用或个人用途。</p>
        <p class="mt-2">3. 本功能为只读：系统不提供通过该入口编辑、删除、爬取、签到或导出他人数据的能力；敏感字段（如 access token）始终隐藏。</p>
        <p class="mt-2">4. 后端会记录该权限的开启状态（admin_global_view_ack）；关闭开关后，查看他人站点的接口将立即恢复拒绝（返回 403）。</p>
        <p class="mt-2">5. 你作为管理员对查看行为负责，应遵守所在地区的数据保护与隐私法律法规。若不同意上述条款，请勿开启本功能。</p>
      </div>

      <!-- 勾选同意：解锁后禁用（撤销先关开关） -->
      <label class="mt-4 flex cursor-pointer items-start gap-2 text-sm">
        <Checkbox
          v-model="agreed"
          :disabled="users.globalViewAck"
          class="mt-0.5"
        />
        <span>我已阅读并同意上述条款，理解此功能仅用于只读的管理排障用途。</span>
      </label>

      <!-- 开关行 -->
      <div class="mt-4 flex items-center gap-4 border-t border-border pt-4">
        <Switch v-model="ackOn" />
        <div>
          <p class="text-sm font-medium">启用「查看他人站点」</p>
          <p class="text-xs text-muted-foreground">需先勾选上方同意项。关闭即撤销权限。</p>
        </div>
      </div>
    </div>
  </div>
</template>
