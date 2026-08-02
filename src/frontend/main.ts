// 前端入口：创建 Vue app 并挂载到 index.html 的 #app。
// 全局样式（Tailwind 指令 + shadcn token CSS 变量）在 style.css。
import { createApp } from 'vue';
import App from './App.vue';
import { i18n } from './i18n';
import './style.css';

createApp(App).use(i18n).mount('#app');
