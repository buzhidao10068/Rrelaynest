<script setup lang="ts">
// 站点新增/编辑弹窗（Phase E）：连接信息 + 汇率（按一次充值折算）+ 分组自动补全
// + 出站代理/测活词选择 + 签到设置区（主开关→自动签到/默认金额）。
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
  sitesState, allGroups, saveSite, nameExists, deriveRecharge,
  type Site, type SiteForm,
} from '@/stores/sites';
import { probeState, PROBE_OFF } from '@/stores/probes';
import { proxyState } from '@/stores/proxies';
import { toast } from '@/composables/useToast';

const props = defineProps<{ open: boolean; editing: Site | null }>();
const emit = defineEmits<{ (e: 'close'): void }>();

// ---- 表单字段 ----
const name = ref('');
const url = ref('');
const token = ref('');
const balRaw = ref('');
const rechargeRmb = ref('10');
const rechargeAmount = ref('1.4');
const cur = ref('USD');
const group = ref('');
const proxy = ref('');
const probeText = ref('');
const email = ref('');
const note = ref('');
const ckMaster = ref(false);
const autoOn = ref(false);
const defAmtOn = ref(false);
const defAmtRaw = ref('');
const errorMsg = ref('');

const isEdit = computed(() => props.editing !== null);
const title = computed(() => (isEdit.value ? '编辑站点' : '新增站点'));
const desc = computed(() => (isEdit.value ? '修改中转站的连接信息与签到设置' : '添加一个新的 new-api 中转站'));
const submitLabel = computed(() => (isEdit.value ? '保存' : '创建'));
const tokenHint = computed(() =>
  isEdit.value
    ? '留空则保留原 token（加密存储，不回显）'
    : '选填。留空可先建档，主页会用红色三角提示该站尚未启用爬取。',
);
const tokenPlaceholder = computed(() =>
  isEdit.value ? '留空则保留原 token' : '选填，不填则该站无法爬取/签到，主页会有提示',
);

// 汇率提示：到账币种 + 折算比率
const ratioHint = computed(() => {
  const c = cur.value.trim() || 'USD';
  const rmb = parseFloat(rechargeRmb.value);
  const amt = parseFloat(rechargeAmount.value);
  let txt = '到账 ' + c;
  if (rmb > 0 && amt > 0) txt += `（1 ${c} ≈ ¥${(rmb / amt).toFixed(2)}）`;
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
    if (site) {
      deriveRecharge(site);
      name.value = site.name;
      url.value = 'https://' + site.url;
      token.value = '';
      balRaw.value = site.balNum != null ? String(site.balNum) : '';
      rechargeRmb.value = String(site.rechargeRmb ?? 10);
      rechargeAmount.value = String(site.rechargeAmount ?? 1.4);
      cur.value = site.cur || 'USD';
      group.value = site.group || '';
      proxy.value = site.proxy || '';
      probeText.value = site.probeText === PROBE_OFF
        ? PROBE_OFF
        : (site.probeText && probeOptions.value.some((w) => w.text === site.probeText) ? site.probeText : '');
      email.value = site.email || '';
      note.value = site.note || '';
      ckMaster.value = site.ck !== 'off';
      autoOn.value = !!site.autoCheckin;
      defAmtOn.value = !!site.defAmtEnabled;
      defAmtRaw.value = site.defAmt != null ? String(site.defAmt) : '';
    } else {
      name.value = '';
      url.value = '';
      token.value = '';
      balRaw.value = '';
      rechargeRmb.value = '10';
      rechargeAmount.value = '1.4';
      cur.value = 'USD';
      group.value = '';
      proxy.value = '';
      probeText.value = '';
      email.value = '';
      note.value = '';
      ckMaster.value = false;
      autoOn.value = false;
      defAmtOn.value = false;
      defAmtRaw.value = '';
    }
  },
  { immediate: true },
);

// 签到主开关关闭时收起并复位详情
watch(ckMaster, (on) => {
  if (!on) {
    autoOn.value = false;
    defAmtOn.value = false;
  }
});

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
function onSubmit() {
  const nm = name.value.trim();
  const u = url.value.trim();
  if (!nm) { errorMsg.value = '请填写站点名称'; return; }
  if (!u) { errorMsg.value = '请填写站点地址'; return; }
  if (!/^https?:\/\//i.test(u)) { errorMsg.value = '站点地址需以 http:// 或 https:// 开头'; return; }
  const rmb = parseFloat(rechargeRmb.value);
  const amt = parseFloat(rechargeAmount.value);
  if (!(rmb > 0)) { errorMsg.value = '充值金额（人民币）必须为正数'; return; }
  if (!(amt > 0)) { errorMsg.value = '到账额度（站点货币）必须为正数'; return; }
  if (String(balRaw.value).trim() !== '' && isNaN(parseFloat(String(balRaw.value)))) {
    errorMsg.value = '余额必须为数字，或留空表示未知'; return;
  }
  if (ckMaster.value && defAmtOn.value) {
    const d = parseFloat(defAmtRaw.value);
    if (!(d >= 0)) { errorMsg.value = '默认签到金额必须为不小于 0 的数字'; return; }
  }
  const editingName = props.editing ? props.editing.name : null;
  if (nameExists(nm, editingName)) { errorMsg.value = '站点名称已存在，请换一个'; return; }

  const form: SiteForm = {
    name: nm, url: u, token: token.value,
    balRaw: String(balRaw.value),
    rechargeRmb: rmb, rechargeAmount: amt,
    cur: cur.value, group: group.value,
    proxy: proxy.value, probeText: probeText.value,
    email: email.value, note: note.value,
    ckMaster: ckMaster.value, autoOn: autoOn.value,
    defAmtOn: defAmtOn.value, defAmtRaw: String(defAmtRaw.value),
  };
  const saved = saveSite(form, editingName);
  toast(editingName === null ? `已创建「${saved}」` : `已保存「${saved}」`, 'success');
  emit('close');
}

// Reka Select 不接受空字符串 value，用哨兵 __follow__ 表示「跟随全局/直连」，
// 读写时与内部 '' 互转。
const FOLLOW = '__follow__';
const proxySel = computed({
  get: () => (proxy.value === '' ? FOLLOW : proxy.value),
  set: (v: string) => { proxy.value = v === FOLLOW ? '' : v; },
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
          <Label>站点名称</Label>
          <Input v-model="name" />
        </div>
        <div class="space-y-1.5">
          <Label>站点地址</Label>
          <Input v-model="url" placeholder="https://..." />
        </div>
        <div class="space-y-1.5">
          <Label>Access Token</Label>
          <Input v-model="token" type="password" :placeholder="tokenPlaceholder" />
          <p class="text-xs text-muted-foreground">{{ tokenHint }}</p>
        </div>
        <div class="space-y-1.5">
          <Label>当前余额（站点货币）</Label>
          <Input v-model="balRaw" type="number" step="0.01" placeholder="留空表示未知" />
          <p class="text-xs text-muted-foreground">可手动填写；爬取或签到后自动更新。</p>
        </div>

        <!-- 汇率 -->
        <div class="space-y-1.5">
          <Label>汇率（按一次充值折算）</Label>
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="text-muted-foreground">充值</span>
            <Input v-model="rechargeRmb" type="number" min="0" step="0.01" class="w-24" />
            <span class="text-muted-foreground">元 =</span>
            <Input v-model="rechargeAmount" type="number" min="0" step="0.0001" class="w-24" />
            <span class="text-muted-foreground">{{ ratioHint }}</span>
          </div>
          <p class="text-xs text-muted-foreground">填写你实际充值时看到的两个数字，如「充 10 元到账 1.4 美元」。人民币站点填 1 = 1 即可。</p>
        </div>
        <div class="space-y-1.5">
          <Label>货币</Label>
          <Input v-model="cur" />
        </div>

        <!-- 分组自动补全 -->
        <div class="space-y-1.5">
          <Label>分组</Label>
          <div class="relative">
            <Input
              id="group-input"
              v-model="group"
              autocomplete="off"
              placeholder="不填=不分组；可选已有组或输入新组名新建"
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
          <p class="text-xs text-muted-foreground">选择已有分组，或输入新名称创建；留空表示不分组。</p>
        </div>

        <!-- 出站代理 -->
        <div class="space-y-1.5">
          <Label>出站代理</Label>
          <Select v-model="proxySel">
            <SelectTrigger>
              <SelectValue placeholder="跟随全局设置" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="FOLLOW">跟随全局设置</SelectItem>
              <SelectItem v-for="p in proxyState.list" :key="p.name" :value="p.name">
                {{ p.name }}（{{ p.type }}）
              </SelectItem>
            </SelectContent>
          </Select>
          <p class="text-xs text-muted-foreground">留空=跟随全局设置；指定后此站单独经该代理出网。在「代理」页可管理代理列表。</p>
        </div>

        <div class="space-y-1.5">
          <Label>注册邮箱</Label>
          <Input v-model="email" />
        </div>
        <div class="space-y-1.5">
          <Label>备注</Label>
          <Textarea v-model="note" rows="2" />
        </div>

        <!-- 测活词 -->
        <div class="space-y-1.5">
          <Label>测活词</Label>
          <Select v-model="probeSel">
            <SelectTrigger>
              <SelectValue :placeholder="`跟随全局（${globalProbe}）`" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="FOLLOW">跟随全局（{{ globalProbe }}）</SelectItem>
              <SelectItem v-for="w in probeOptions" :key="w.text" :value="w.text">{{ w.text }}</SelectItem>
              <SelectItem :value="PROBE_OFF">不测活（跳过连接与渠道检测）</SelectItem>
            </SelectContent>
          </Select>
          <p class="text-xs text-muted-foreground">测活页「渠道测试」发给本站模型的话，模型正常回复即判存活；留空则跟随全局默认词；选「不测活」则测活页两种检测都跳过本站。词条在「测活」页管理。</p>
        </div>

        <!-- 签到设置区 -->
        <div class="space-y-4 rounded-lg border border-border p-4">
          <div class="flex items-center gap-4">
            <Switch v-model="ckMaster" />
            <div>
              <p class="text-sm font-medium">签到</p>
              <p class="text-xs text-muted-foreground">启用后可自动或手动签到（需站点支持 /api/user/checkin）</p>
            </div>
          </div>
          <div v-if="ckMaster" class="space-y-4 border-t border-border pt-4">
            <div class="flex items-center gap-4">
              <Switch v-model="autoOn" />
              <div>
                <p class="text-sm font-medium">启用自动签到</p>
                <p class="text-xs text-muted-foreground">每日跨天自动执行签到，无需手动点击。</p>
              </div>
            </div>
            <div class="space-y-2">
              <div class="flex items-center gap-4">
                <Switch v-model="defAmtOn" />
                <div>
                  <p class="text-sm font-medium">默认签到增加金额</p>
                  <p class="text-xs text-muted-foreground">签到时固定到账此金额；关闭后每次手动签到需自行填写。</p>
                </div>
              </div>
              <div v-if="defAmtOn" class="pl-[3.75rem]">
                <div class="flex items-center gap-2">
                  <Input v-model="defAmtRaw" type="number" min="0" step="0.01" placeholder="0.00" class="h-9 w-32" />
                  <span class="text-sm text-muted-foreground">每次签到到账（站点货币）</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <p v-if="errorMsg" class="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500">
          {{ errorMsg }}
        </p>

        <div class="flex justify-end gap-2">
          <Button variant="outline" @click="emit('close')">取消</Button>
          <Button @click="onSubmit">{{ submitLabel }}</Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>
