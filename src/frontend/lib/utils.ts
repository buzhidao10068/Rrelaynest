// cn(): 合并 Tailwind 类名，处理条件类与冲突去重（shadcn-vue 标准工具）。
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
