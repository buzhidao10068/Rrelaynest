// 主题：亮色 / 暗色 / 跟随系统。照搬 docs/ui-preview.html 的 applyTheme 逻辑。
// 单例 reactive state：任意组件调用 useTheme() 共享同一份 theme。
// FOUC 守卫在 index.html 内联脚本里先跑一次（paint 前），这里负责运行时切换 + 监听系统变化。
import { ref, readonly } from 'vue';

export type Theme = 'light' | 'dark' | 'system';

const THEME_KEY = 'rrelaynest-theme';
const mql = window.matchMedia('(prefers-color-scheme: dark)');

function loadTheme(): Theme {
  const t = localStorage.getItem(THEME_KEY);
  return t === 'light' || t === 'dark' ? t : 'system';
}

const theme = ref<Theme>(loadTheme());

// 依据当前 theme 计算是否暗色，切 <html> 的 .dark 类
function apply(t: Theme): void {
  const dark = t === 'dark' || (t === 'system' && mql.matches);
  document.documentElement.classList.toggle('dark', dark);
}

// 系统主题变化时，仅在「跟随系统」下重算
mql.addEventListener('change', () => {
  if (theme.value === 'system') apply('system');
});

let bound = false;

export function useTheme() {
  // 首次使用时对齐一次（防 FOUC 脚本与响应式态不同步）
  if (!bound) {
    apply(theme.value);
    bound = true;
  }

  function setTheme(t: Theme): void {
    theme.value = t;
    localStorage.setItem(THEME_KEY, t);
    apply(t);
  }

  return { theme: readonly(theme), setTheme };
}
