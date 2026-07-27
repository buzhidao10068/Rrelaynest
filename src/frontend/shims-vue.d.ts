// 让 tsc 认识 .vue 单文件组件（import App from './App.vue'）。
// vite 构建期由 @vitejs/plugin-vue 处理，这里只补类型声明供 typecheck。
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
