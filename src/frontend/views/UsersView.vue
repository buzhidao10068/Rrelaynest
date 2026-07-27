<script setup lang="ts">
// 用户管理页（Phase J，仅 admin）：邀请制说明 + 跨用户只读解锁提示 + 用户卡片列表。
// 每卡：头像 + 用户名 + 角色/状态徽章 + 站点数/创建日期 + 查看站点/编辑/停用/删除。
// 自我保护：id=1（自己）不能停用/删除/降级；查看站点需已解锁 ack（双门控）。
import { ref } from 'vue';
import { Plus, Eye, Pencil, Ban, CircleCheck, Trash2 } from 'lucide-vue-next';
import AppHeader from '@/components/AppHeader.vue';
import { Button } from '@/components/ui/button';
import {
  users, isSelf, toggleUserDisabled, deleteUser, showUserSites,
  goPrivacySettings, type MockUser,
} from '@/stores/users';
import { toast } from '@/composables/useToast';
import UserModal from '@/components/users/UserModal.vue';

const modalOpen = ref(false);
const modalEditing = ref<MockUser | null>(null);

function onCreate() {
  modalEditing.value = null;
  modalOpen.value = true;
}
function onEdit(u: MockUser) {
  modalEditing.value = u;
  modalOpen.value = true;
}
function onView(u: MockUser) {
  if (!users.globalViewAck) {
    toast('请先到 设置 → 协作与隐私 解锁条款', 'error');
    return;
  }
  showUserSites(u.id);
}
function onToggle(u: MockUser) {
  const d = toggleUserDisabled(u.id);
  if (d === null) return;
  toast(d ? `已停用 ${u.username}（其已登录会话立即失效）` : `已启用 ${u.username}`, 'success');
}
function onDelete(u: MockUser) {
  if (!confirm(`确认删除用户「${u.username}」？其所有站点/代理/设置将一并删除，不可恢复。`)) return;
  if (deleteUser(u.id)) toast(`已删除用户 ${u.username}`, 'success');
}

function roleBadgeClass(u: MockUser): string {
  return u.role === 'admin'
    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
    : 'bg-muted text-muted-foreground';
}
function avatarChar(u: MockUser): string {
  return (u.username[0] || 'U').toUpperCase();
}
</script>

<template>
  <div class="min-h-screen bg-background">
    <AppHeader title="用户管理">
      <template #actions>
        <Button size="sm" @click="onCreate">
          <Plus :size="15" />
          新增用户
        </Button>
      </template>
    </AppHeader>

    <div class="mx-auto max-w-[960px] space-y-4 p-4 sm:p-6">
      <!-- 邀请制说明 + 跨用户只读状态提示 -->
      <div class="rounded-lg border border-border bg-muted/40 p-4 text-sm">
        <p class="font-medium">邀请制</p>
        <p class="mt-1 text-xs text-muted-foreground">
          系统不开放自助注册，只有管理员在此手动开号。每个用户的站点、代理、设置完全隔离，互不可见。
        </p>
        <p class="mt-2 text-xs">
          <template v-if="users.globalViewAck">
            <span class="text-green-600 dark:text-green-400">✓ 已解锁「查看他人站点」</span>
            ——可点各用户的「查看站点」只读查看。前往
            <button class="underline hover:opacity-80" @click="goPrivacySettings">设置 → 协作与隐私</button>
            可撤销。
          </template>
          <template v-else>
            「查看他人站点」默认关闭。需先到
            <button class="underline hover:opacity-80" @click="goPrivacySettings">设置 → 协作与隐私</button>
            阅读条款并同意后，才能只读查看用户站点。
          </template>
        </p>
      </div>

      <!-- 用户卡片列表 -->
      <div v-if="users.users.length" class="space-y-2">
        <div
          v-for="u in users.users"
          :key="u.id"
          class="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4"
        >
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium">
            {{ avatarChar(u) }}
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium">{{ u.username }}</span>
              <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="roleBadgeClass(u)">
                {{ u.role === 'admin' ? '管理员' : '用户' }}
              </span>
              <span
                v-if="u.disabled"
                class="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400"
              >已停用</span>
              <span
                v-else
                class="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400"
              >正常</span>
              <span v-if="isSelf(u.id)" class="text-xs text-muted-foreground">(你)</span>
            </div>
            <p class="mt-0.5 text-xs text-muted-foreground">
              {{ u.sites }} 个站点 · 创建于 {{ u.created_at }}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <!-- 查看站点：自己不需要（看自己走主页）；未解锁则禁用提示 -->
            <Button
              v-if="!isSelf(u.id)"
              variant="outline"
              size="sm"
              :class="!users.globalViewAck && 'opacity-50'"
              :title="users.globalViewAck ? '' : '需先在设置解锁条款'"
              @click="onView(u)"
            >
              <Eye :size="14" />
              查看站点
            </Button>
            <Button variant="outline" size="sm" @click="onEdit(u)">
              <Pencil :size="14" />
              编辑
            </Button>
            <!-- 停用/启用：不能对自己 -->
            <Button
              variant="outline"
              size="sm"
              :disabled="isSelf(u.id)"
              :title="isSelf(u.id) ? '不能停用自己' : ''"
              @click="onToggle(u)"
            >
              <component :is="u.disabled ? CircleCheck : Ban" :size="14" />
              {{ u.disabled ? '启用' : '停用' }}
            </Button>
            <!-- 删除：不能删自己 -->
            <Button
              variant="outline"
              size="sm"
              class="border-red-500/40 text-red-500 hover:bg-red-500/10 hover:text-red-500"
              :disabled="isSelf(u.id)"
              :title="isSelf(u.id) ? '不能删除自己' : ''"
              @click="onDelete(u)"
            >
              <Trash2 :size="14" />
              删除
            </Button>
          </div>
        </div>
      </div>
      <div
        v-else
        class="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground"
      >
        暂无用户
      </div>
    </div>

    <UserModal :open="modalOpen" :editing="modalEditing" @close="modalOpen = false" />
  </div>
</template>
