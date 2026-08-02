// 语言切换单例：照搬 useTheme 的形态（单例 reactive + localStorage）。
// 登录前后共用；setLocale 写 localStorage + 更新单例 currentLocale + 同步 <html lang>。
//
// 刻意不 import ./index：与 i18n 运行时 locale 的同步由 index.ts 建 watch(currentLocale) 回灌，
// 保持「index → useLocale」单向依赖。否则组件先 import 本模块时会成环——index 会在本模块
// LOCALE_KEY 求值前就调用 loadLocale()，触发 TDZ「Cannot access 'LOCALE_KEY' before initialization」。
import { ref, readonly } from 'vue';

export type Locale = 'zh-CN' | 'zh-TW' | 'en';

const LOCALE_KEY = 'rrelaynest-locale';

// 切换器展示用：label 用各语言「自称」，不随当前界面语言变，
// 避免用户切到陌生语言后找不到自己的母语。short 是侧栏窄段控件用的极简标签
// （简/繁/EN，与文字无关、任何界面语言下都认得，同样保留「找回母语」的能力）。
export const LOCALES: { key: Locale; label: string; short: string }[] = [
  { key: 'zh-CN', label: '简体中文', short: '简' },
  { key: 'zh-TW', label: '繁體中文', short: '繁' },
  { key: 'en', label: 'English', short: 'EN' },
];

function isLocale(v: string | null): v is Locale {
  return v === 'zh-CN' || v === 'zh-TW' || v === 'en';
}

// 供 i18n 实例初始化时同步读取（首屏即正确语言，无闪烁）。
export function loadLocale(): Locale {
  const v = localStorage.getItem(LOCALE_KEY);
  return isLocale(v) ? v : 'zh-CN';
}

// 单例响应式当前语言。index.ts watch 它来驱动 i18n.global.locale.value。
export const currentLocale = ref<Locale>(loadLocale());

export function useLocale() {
  function setLocale(l: Locale): void {
    currentLocale.value = l;
    localStorage.setItem(LOCALE_KEY, l);
    document.documentElement.lang = l;
  }
  return { locale: readonly(currentLocale), setLocale, locales: LOCALES };
}
