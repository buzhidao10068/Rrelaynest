// vue-i18n 实例（Composition API 模式 legacy:false）。
// 初始语言在实例创建时同步从 localStorage 读取 → 首屏即正确语言，无语言闪烁。
// 导出 t 供非组件（stores / api / composables）调用：import { t } from '@/i18n'。
import { watch } from 'vue';
import { createI18n } from 'vue-i18n';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import en from './locales/en.json';
import { loadLocale, currentLocale } from './useLocale';

export const i18n = createI18n({
  legacy: false,
  // 全局注入 $t 等到每个组件模板：纯模板组件无需 import，直接 {{ $t('key') }}。
  globalInjection: true,
  locale: loadLocale(),
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': zhCN,
    'zh-TW': zhTW,
    en,
  },
});

// 首屏同步 <html lang>（与 loadLocale 保持一致）。
document.documentElement.lang = loadLocale();

// useLocale.setLocale 只改 currentLocale（不 import 本模块，避免循环 import → TDZ）；
// 这里单向 watch 回灌到 vue-i18n 运行时 locale。初值二者已一致，无需 immediate。
watch(currentLocale, (l) => {
  i18n.global.locale.value = l;
});

// 非组件里的翻译函数（toast / throw Error / store 展示串）。
export const t = i18n.global.t;
