<script setup lang="ts">
// 跨用户只读站点页（Phase J，仅 admin + 已解锁 ack）：顶部醒目「只读」横幅 + 站点卡片列表。
// 无任何写/删/爬取/签到入口；token 已隐藏。数据来自 users.userSites[viewingUserId]。
import { computed, watch } from 'vue';
import { ChevronLeft, Eye } from 'lucide-vue-next';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { users, findUser, showAdminUsers, loadUserSites, type UserSite } from '@/stores/users';
import { ApiError } from '@/api';
import { toast } from '@/composables/useToast';

const viewing = computed(() => (users.viewingUserId != null ? findUser(users.viewingUserId) : undefined));
const list = computed<UserSite[]>(() =>
  users.viewingUserId != null ? (users.userSites[users.viewingUserId] || []) : [],
);

// viewingUserId 变化即拉取该用户站点（双门控由后端 requireAdmin+ack 把关，403 时提示）。
watch(
  () => users.viewingUserId,
  (uid) => {
    if (uid == null) return;
    loadUserSites(uid).catch((e) =>
      toast(e instanceof ApiError ? e.message : '载入用户站点失败', 'error'),
    );
  },
  { immediate: true },
);

function back() {
  showAdminUsers();
}
</script>

<template>
  <div class="min-h-screen bg-background">
    <!-- 顶栏：返回用户管理 + 标题（带用户名） -->
    <header
      class="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60"
    >
      <SidebarTrigger class="-ml-1" />
      <Separator orientation="vertical" class="mr-1 h-4" />
      <Button variant="ghost" size="icon" class="h-8 w-8" title="返回用户管理" @click="back">
        <ChevronLeft :size="18" />
      </Button>
      <h1 class="text-base font-semibold">用户站点 · {{ viewing?.username ?? '—' }}</h1>
    </header>

    <div class="mx-auto max-w-[960px] space-y-4 p-4 sm:p-6">
      <!-- 只读横幅：强调管理员越权查看的边界与责任 -->
      <div class="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <Eye :size="18" class="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <p class="font-medium text-amber-700 dark:text-amber-300">管理员只读视图</p>
          <p class="mt-0.5 text-xs text-amber-700/80 dark:text-amber-300/80">
            仅用于管理排障。此处只能查看，不能编辑、删除、爬取或签到；token 已隐藏。
          </p>
        </div>
      </div>

      <!-- 站点卡片列表（只读） -->
      <div v-if="list.length" class="space-y-2">
        <div
          v-for="s in list"
          :key="s.name"
          class="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4"
        >
          <div class="min-w-0 flex-1">
            <p class="truncate font-medium">{{ s.name }}</p>
            <p class="mt-0.5 truncate text-xs text-muted-foreground">{{ s.base_url }}</p>
          </div>
          <div class="shrink-0 text-right text-sm">
            <p class="font-medium">{{ s.balance }} {{ s.currency }}</p>
            <p class="mt-0.5 text-xs">
              <span v-if="!s.checkin_enabled" class="text-muted-foreground">未开启</span>
              <span v-else-if="s.checkin_done" class="text-green-600 dark:text-green-400">今日已签</span>
              <span v-else class="text-muted-foreground">未签</span>
            </p>
          </div>
        </div>
      </div>
      <div
        v-else
        class="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground"
      >
        该用户暂无站点
      </div>
    </div>
  </div>
</template>
