<script setup lang="ts">
// 用户管理页（Phase J，仅 admin）：邀请制说明 + 跨用户只读解锁提示 + 用户卡片列表。
// 每卡：头像 + 用户名 + 角色/状态徽章 + 站点数/创建日期 + 查看站点/编辑/停用/删除。
// 自我保护：id=1（自己）不能停用/删除/降级；查看站点需已解锁 ack（双门控）。
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { Plus, Eye, Pencil, Ban, CircleCheck, Trash2 } from 'lucide-vue-next';
import AppHeader from '@/components/AppHeader.vue';
import { Button } from '@/components/ui/button';
import {
  users, isSelf, toggleUserDisabled, deleteUser, showUserSites,
  goPrivacySettings, loadUsers, type AdminUser,
} from '@/stores/users';
import { ApiError } from '@/api';
import { toast } from '@/composables/useToast';
import UserModal from '@/components/users/UserModal.vue';

const { t } = useI18n({ useScope: 'global' });

const modalOpen = ref(false);
const modalEditing = ref<AdminUser | null>(null);

function errMsg(e: unknown, fallback: string): string {
  return e instanceof ApiError ? e.message : fallback;
}

onMounted(() => {
  loadUsers().catch((e) => toast(errMsg(e, t('users.loadListFailed')), 'error'));
});

function onCreate() {
  modalEditing.value = null;
  modalOpen.value = true;
}
function onEdit(u: AdminUser) {
  modalEditing.value = u;
  modalOpen.value = true;
}
function onView(u: AdminUser) {
  const err = showUserSites(u.id);
  if (err) toast(err, 'error');
}
async function onToggle(u: AdminUser) {
  try {
    const d = await toggleUserDisabled(u.id);
    if (d === null) return;
    toast(d ? t('users.disabledToast', { name: u.username }) : t('users.enabledToast', { name: u.username }), 'success');
  } catch (e) {
    toast(errMsg(e, t('common.failed')), 'error');
  }
}
async function onDelete(u: AdminUser) {
  if (!confirm(t('users.deleteConfirm', { name: u.username }))) return;
  try {
    if (await deleteUser(u.id)) toast(t('users.deletedToast', { name: u.username }), 'success');
  } catch (e) {
    toast(errMsg(e, t('users.deleteFailed')), 'error');
  }
}

function roleBadgeClass(u: AdminUser): string {
  return u.role === 'admin'
    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
    : 'bg-muted text-muted-foreground';
}
function avatarChar(u: AdminUser): string {
  return (u.username[0] || 'U').toUpperCase();
}
// created_at 是毫秒时间戳（后端），转本地日期串展示。
function createdText(u: AdminUser): string {
  return u.created_at ? new Date(u.created_at).toLocaleDateString() : '—';
}
</script>

<template>
  <div class="min-h-screen bg-background">
    <AppHeader :title="t('users.title')">
      <template #actions>
        <Button size="sm" @click="onCreate">
          <Plus :size="15" />
          {{ t('users.addUser') }}
        </Button>
      </template>
    </AppHeader>

    <div class="mx-auto max-w-[960px] space-y-4 p-4 sm:p-6">
      <!-- 邀请制说明 + 跨用户只读状态提示 -->
      <div class="rounded-lg border border-border bg-muted/40 p-4 text-sm">
        <p class="font-medium">{{ t('users.inviteSystem') }}</p>
        <p class="mt-1 text-xs text-muted-foreground">
          {{ t('users.inviteDesc') }}
        </p>
        <p class="mt-2 text-xs">
          <template v-if="users.globalViewAck">
            <span class="text-green-600 dark:text-green-400">{{ t('users.viewOthersUnlocked') }}</span>
            {{ t('users.viewOthersUnlockedDesc') }}
            <button class="underline hover:opacity-80" @click="goPrivacySettings">{{ t('users.privacySettingsLink') }}</button>
            {{ t('users.canRevoke') }}
          </template>
          <template v-else>
            {{ t('users.viewOthersLocked') }}
            <button class="underline hover:opacity-80" @click="goPrivacySettings">{{ t('users.privacySettingsLink') }}</button>
            {{ t('users.viewOthersLockedSuffix') }}
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
                {{ u.role === 'admin' ? t('users.roleAdmin') : t('users.roleUser') }}
              </span>
              <span
                v-if="u.disabled"
                class="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-600 dark:text-red-400"
              >{{ t('users.statusDisabled') }}</span>
              <span
                v-else
                class="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400"
              >{{ t('users.statusNormal') }}</span>
              <span v-if="isSelf(u.id)" class="text-xs text-muted-foreground">{{ t('users.you') }}</span>
            </div>
            <p class="mt-0.5 text-xs text-muted-foreground">
              {{ t('users.sitesAndCreated', { n: u.sites, date: createdText(u) }) }}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <!-- 查看站点：自己不需要（看自己走主页）；未解锁则禁用提示 -->
            <Button
              v-if="!isSelf(u.id)"
              variant="outline"
              size="sm"
              :class="!users.globalViewAck && 'opacity-50'"
              :title="users.globalViewAck ? '' : t('users.needUnlockTitle')"
              @click="onView(u)"
            >
              <Eye :size="14" />
              {{ t('users.viewSites') }}
            </Button>
            <Button variant="outline" size="sm" @click="onEdit(u)">
              <Pencil :size="14" />
              {{ t('common.edit') }}
            </Button>
            <!-- 停用/启用：不能对自己 -->
            <Button
              variant="outline"
              size="sm"
              :disabled="isSelf(u.id)"
              :title="isSelf(u.id) ? t('users.cannotDisableSelf') : ''"
              @click="onToggle(u)"
            >
              <component :is="u.disabled ? CircleCheck : Ban" :size="14" />
              {{ u.disabled ? t('common.enable') : t('users.disableAction') }}
            </Button>
            <!-- 删除：不能删自己 -->
            <Button
              variant="outline"
              size="sm"
              class="border-red-500/40 text-red-500 hover:bg-red-500/10 hover:text-red-500"
              :disabled="isSelf(u.id)"
              :title="isSelf(u.id) ? t('users.cannotDeleteSelf') : ''"
              @click="onDelete(u)"
            >
              <Trash2 :size="14" />
              {{ t('common.delete') }}
            </Button>
          </div>
        </div>
      </div>
      <div
        v-else
        class="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground"
      >
        {{ t('users.empty') }}
      </div>
    </div>

    <UserModal :open="modalOpen" :editing="modalEditing" @close="modalOpen = false" />
  </div>
</template>
