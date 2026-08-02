<script setup lang="ts">
// 站点新增/编辑弹窗（块8：接线后端）：连接信息 + 汇率（按一次充值折算 rate）+ 分组自动补全
// + 出站代理/测活词选择 + 签到主开关（→ checkin_enabled，每日自动签到走后端 scheduler）。
// 与 mock 差异：模型来自爬取(site_models)只读展示，不再手动获取；默认金额/手动金额记账砍掉；
// 余额改为可选「种子」（爬取后即被覆盖）。保存走后端 saveSite（异步），成功后 store 已 reload。
import { ref, computed, watch, nextTick } from 'vue';
import { ChevronDown } from 'lucide-vue-next';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import Switch from '@/components/ui/switch/Switch.vue';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  allGroups, saveSite, nameExists,
  type Site, type SiteForm,
} from '@/stores/sites';
import { probeState } from '@/stores/probes';
import { proxyState } from '@/stores/proxies';
import { settingsState } from '@/stores/settings';
import { ApiError } from '@/api';
import { toast } from '@/composables/useToast';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ open: boolean; editing: Site | null }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const { t } = useI18n({ useScope: 'global' });

// ---- 表单字段 ----
const name = ref('');
const url = ref('');
const token = ref('');
const balRaw = ref('');
const rechargeRmb = ref('10');
const rechargeAmount = ref('1.4');
const cur = ref('USD');
const group = ref('');
const proxyId = ref<number | null>(null);
const probeText = ref('');
const email = ref('');
const note = ref('');
const ckMaster = ref(false);
const errorMsg = ref('');
const busy = ref(false);

// 爬取所得模型（只读展示）
const models = ref<string[]>([]);

const isEdit = computed(() => props.editing !== null);
const title = computed(() => (isEdit.value ? t('siteEditor.titleEdit') : t('siteEditor.titleAdd')));
const desc = computed(() => (isEdit.value ? t('siteEditor.descEdit') : t('siteEditor.descAdd')));
const submitLabel = computed(() => (isEdit.value ? t('common.save') : t('siteEditor.create')));
const tokenHint = computed(() =>
  isEdit.value ? t('siteEditor.tokenHintEdit') : t('siteEditor.tokenHintAdd'),
);
const tokenPlaceholder = computed(() =>
  isEdit.value ? t('siteEditor.tokenPhEdit') : t('siteEditor.tokenPhAdd'),
);

// 汇率提示：到账币种 + 折算比率
const ratioHint = computed(() => {
  const c = cur.value.trim() || 'USD';
  const rmb = parseFloat(rechargeRmb.value);
  const amt = parseFloat(rechargeAmount.value);
  let txt = t('siteEditor.field.received', { cur: c });
  if (rmb > 0 && amt > 0) txt += t('siteEditor.field.ratioSuffix', { cur: c, rate: (rmb / amt).toFixed(2) });
  return txt;
});

// 测活词下拉：跟随全局 + 启用中的词条
const probeOptions = computed(() => probeState.words.filter((w) => w.enabled));
const globalProbe = computed(() => probeState.globalText);

// 打开时回填
watch(
  () => [props.open, props.editing] as const,
  ([open, site]) => {
    if (!open) return;
    errorMsg.value = '';
    busy.value = false;
    if (site) {
      const rate = parseFloat(site.rate) || 1;
      name.value = site.name;
      url.value = 'https://' + site.url;
      token.value = '';
      balRaw.value = site.balNum != null ? String(site.balNum) : '';
      // rate = 每 1 单位站点货币折多少 RMB。回填成「充 rate 元 = 到账 1」。
      rechargeRmb.value = String(rate);
      rechargeAmount.value = '1';
      cur.value = site.cur || 'USD';
      group.value = site.group || '';
      proxyId.value = site.proxyId;
      probeText.value = site.probeText && probeOptions.value.some((w) => w.text === site.probeText) ? site.probeText : '';
      email.value = site.email || '';
      note.value = site.note || '';
      ckMaster.value = site.ck !== 'off';
      models.value = site.models?.slice() ?? [];
    } else {
      name.value = '';
      url.value = '';
      token.value = '';
      balRaw.value = '';
      rechargeRmb.value = '10';
      rechargeAmount.value = '1.4';
      cur.value = 'USD';
      group.value = '';
      proxyId.value = null;
      probeText.value = '';
      email.value = '';
      note.value = '';
      // 新建默认签到态取「新增站点默认开启签到」设置（settings.checkinDefaultOn）。
      ckMaster.value = settingsState.checkinDefaultOn;
      models.value = [];
    }
  },
  { immediate: true },
);

// ---- 分组自动补全下拉 ----
const groupMenuOpen = ref(false);
const groupCandidates = computed(() => {
  const q = group.value.trim();
  return allGroups.value
    .filter((g) => g !== '未分组')
    .filter((g) => !q || g.toLowerCase().includes(q.toLowerCase()));
});
function pickGroup(g: string) {
  group.value = g;
  groupMenuOpen.value = false;
}
function toggleGroupMenu() {
  groupMenuOpen.value = !groupMenuOpen.value;
  // 官方 Input 未转发 ref 到内部 <input>，用 id 聚焦。
  if (groupMenuOpen.value) nextTick(() => document.getElementById('group-input')?.focus());
}

// ---- 提交 ----
async function onSubmit() {
  if (busy.value) return;
  const nm = name.value.trim();
  const u = url.value.trim();
  if (!nm) { errorMsg.value = t('siteEditor.errNameRequired'); return; }
  if (!u) { errorMsg.value = t('siteEditor.errUrlRequired'); return; }
  if (!/^https?:\/\//i.test(u)) { errorMsg.value = t('siteEditor.errUrlScheme'); return; }
  const rmb = parseFloat(rechargeRmb.value);
  const amt = parseFloat(rechargeAmount.value);
  if (!(rmb > 0)) { errorMsg.value = t('siteEditor.errRechargePositive'); return; }
  if (!(amt > 0)) { errorMsg.value = t('siteEditor.errAmountPositive'); return; }
  if (String(balRaw.value).trim() !== '' && isNaN(parseFloat(String(balRaw.value)))) {
    errorMsg.value = t('siteEditor.errBalNumber'); return;
  }
  const editingId = props.editing ? props.editing.id : null;
  if (nameExists(nm, editingId)) { errorMsg.value = t('siteEditor.errNameExists'); return; }

  const form: SiteForm = {
    name: nm, url: u, token: token.value,
    balRaw: String(balRaw.value),
    rechargeRmb: rmb, rechargeAmount: amt,
    cur: cur.value, group: group.value,
    proxyId: proxyId.value, probeText: probeText.value,
    email: email.value, note: note.value,
    ckMaster: ckMaster.value,
  };
  busy.value = true;
  try {
    const saved = await saveSite(form, editingId);
    toast(editingId === null ? t('siteEditor.toastCreated', { name: saved }) : t('siteEditor.toastSaved', { name: saved }), 'success');
    emit('close');
  } catch (e) {
    errorMsg.value = e instanceof ApiError ? e.message : t('siteEditor.saveFailed');
    toast(errorMsg.value, 'error');
  } finally {
    busy.value = false;
  }
}

// Reka Select 不接受空字符串 value，用哨兵表示「跟随全局/直连」，读写时与内部值互转。
const FOLLOW = '__follow__';
const proxySel = computed({
  get: () => (proxyId.value == null ? FOLLOW : String(proxyId.value)),
  set: (v: string) => { proxyId.value = v === FOLLOW ? null : Number(v); },
});
const probeSel = computed({
  get: () => (probeText.value === '' ? FOLLOW : probeText.value),
  set: (v: string) => { probeText.value = v === FOLLOW ? '' : v; },
});
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && emit('close')">
    <DialogContent class="max-h-[calc(100vh-2rem)] max-w-[540px] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription>{{ desc }}</DialogDescription>
      </DialogHeader>

      <div class="space-y-5">
        <div class="space-y-1.5">
          <Label>{{ t('siteEditor.field.name') }}</Label>
          <Input v-model="name" />
        </div>
        <div class="space-y-1.5">
          <Label>{{ t('siteEditor.field.url') }}</Label>
          <Input v-model="url" placeholder="https://..." />
        </div>
        <div class="space-y-1.5">
          <Label>Access Token</Label>
          <Input v-model="token" type="password" :placeholder="tokenPlaceholder" />
          <p class="text-xs text-muted-foreground">{{ tokenHint }}</p>
        </div>

        <!-- 上游模型（爬取所得，只读）-->
        <div class="space-y-1.5">
          <Label>{{ t('siteEditor.field.upstreamModels') }}</Label>
          <div
            v-if="models.length"
            class="flex flex-wrap gap-1.5 rounded-md border border-border bg-muted/30 p-2"
          >
            <span
              v-for="m in models"
              :key="m"
              class="inline-flex items-center rounded-md bg-background px-2 py-0.5 font-mono text-xs"
            >{{ m }}</span>
          </div>
          <p v-else class="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {{ t('siteEditor.field.noModels') }}
          </p>
          <p class="text-xs text-muted-foreground">
            {{ t('siteEditor.field.modelsFrom', { path: '{base}/v1/models' }) }}
          </p>
        </div>

        <div class="space-y-1.5">
          <Label>{{ t('siteEditor.field.balance') }}</Label>
          <Input v-model="balRaw" type="number" step="0.01" :placeholder="t('siteEditor.field.balancePlaceholder')" />
          <p class="text-xs text-muted-foreground">{{ t('siteEditor.field.balanceHint') }}</p>
        </div>

        <!-- 汇率 -->
        <div class="space-y-1.5">
          <Label>{{ t('siteEditor.field.rate') }}</Label>
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="text-muted-foreground">{{ t('siteEditor.field.recharge') }}</span>
            <Input v-model="rechargeRmb" type="number" min="0" step="0.01" class="w-24" />
            <span class="text-muted-foreground">{{ t('siteEditor.field.yuanEq') }}</span>
            <Input v-model="rechargeAmount" type="number" min="0" step="0.0001" class="w-24" />
            <span class="text-muted-foreground">{{ ratioHint }}</span>
          </div>
          <p class="text-xs text-muted-foreground">{{ t('siteEditor.field.rateHint') }}</p>
        </div>
        <div class="space-y-1.5">
          <Label>{{ t('siteEditor.field.currency') }}</Label>
          <Input v-model="cur" />
        </div>

        <!-- 分组自动补全 -->
        <div class="space-y-1.5">
          <Label>{{ t('siteEditor.field.group') }}</Label>
          <div class="relative">
            <Input
              id="group-input"
              v-model="group"
              autocomplete="off"
              :placeholder="t('siteEditor.field.groupPlaceholder')"
              class="pr-9"
              @focus="groupMenuOpen = true"
            />
            <Button
              type="button" variant="ghost" size="icon" tabindex="-1"
              class="absolute inset-y-0 right-0 h-full w-9 text-muted-foreground hover:bg-transparent hover:text-foreground"
              @click="toggleGroupMenu"
            >
              <ChevronDown :size="15" />
            </Button>
            <div
              v-if="groupMenuOpen && groupCandidates.length"
              class="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md"
            >
              <Button
                v-for="g in groupCandidates"
                :key="g"
                type="button"
                variant="ghost"
                class="h-auto w-full justify-start rounded-sm px-2 py-1.5 text-left text-sm font-normal"
                @mousedown.prevent="pickGroup(g)"
              >{{ g }}</Button>
            </div>
          </div>
          <p class="text-xs text-muted-foreground">{{ t('siteEditor.field.groupHint') }}</p>
        </div>

        <!-- 出站代理 -->
        <div class="space-y-1.5">
          <Label>{{ t('siteEditor.field.proxy') }}</Label>
          <Select v-model="proxySel">
            <SelectTrigger>
              <SelectValue :placeholder="t('siteEditor.field.followGlobal')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="FOLLOW">{{ t('siteEditor.field.followGlobal') }}</SelectItem>
              <SelectItem v-for="p in proxyState.list" :key="p.id" :value="String(p.id)">
                {{ p.name }}（{{ p.type }}）
              </SelectItem>
            </SelectContent>
          </Select>
          <p class="text-xs text-muted-foreground">{{ t('siteEditor.field.proxyHint') }}</p>
        </div>

        <div class="space-y-1.5">
          <Label>{{ t('siteEditor.field.email') }}</Label>
          <Input v-model="email" />
        </div>
        <div class="space-y-1.5">
          <Label>{{ t('siteEditor.field.note') }}</Label>
          <Textarea v-model="note" rows="2" />
        </div>

        <!-- 测活词 -->
        <div class="space-y-1.5">
          <Label>{{ t('siteEditor.field.probeWord') }}</Label>
          <Select v-model="probeSel">
            <SelectTrigger>
              <SelectValue :placeholder="t('siteEditor.field.followGlobalWord', { word: globalProbe })" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="FOLLOW">{{ t('siteEditor.field.followGlobalWord', { word: globalProbe }) }}</SelectItem>
              <SelectItem v-for="w in probeOptions" :key="w.text" :value="w.text">{{ w.text }}</SelectItem>
            </SelectContent>
          </Select>
          <p class="text-xs text-muted-foreground">{{ t('siteEditor.field.probeWordHint') }}</p>
        </div>

        <!-- 签到设置区 -->
        <div class="space-y-4 rounded-lg border border-border p-4">
          <div class="flex items-center gap-4">
            <Switch v-model="ckMaster" />
            <div>
              <p class="text-sm font-medium">{{ t('siteEditor.field.checkin') }}</p>
              <p class="text-xs text-muted-foreground">{{ t('siteEditor.field.checkinHint') }}</p>
            </div>
          </div>
        </div>

        <p v-if="errorMsg" class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {{ errorMsg }}
        </p>

        <div class="flex justify-end gap-2">
          <Button variant="outline" :disabled="busy" @click="emit('close')">{{ t('common.cancel') }}</Button>
          <Button :disabled="busy" @click="onSubmit">{{ busy ? t('common.saving') : submitLabel }}</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
