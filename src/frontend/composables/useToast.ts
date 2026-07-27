// 轻量 toast 单例：全局一个队列，<ToastHost> 渲染，任意组件 push。
import { reactive } from 'vue';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  msg: string;
  kind: ToastKind;
}

const state = reactive<{ items: ToastItem[] }>({ items: [] });
let seq = 0;

export function toast(msg: string, kind: ToastKind = 'info'): void {
  const id = ++seq;
  state.items.push({ id, msg, kind });
  setTimeout(() => {
    const idx = state.items.findIndex((t) => t.id === id);
    if (idx >= 0) state.items.splice(idx, 1);
  }, 2400);
}

export function useToastState() {
  return state;
}
