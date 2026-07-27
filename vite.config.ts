import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

// 前端构建：产物输出到 dist/，供 Workers [assets] 或 Node serveStatic 托管。
// 开发时前端热更新走 5173，/api 代理到本地后端。
// 默认代理到 Node/Docker server（3100）；调试 Workers 时设 DEV_API_PORT=7738 切到 wrangler dev。
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiPort = env.DEV_API_PORT ?? '3100';
  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src/frontend', import.meta.url)),
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
    server: {
      port: 5173,
      proxy: {
        '/api': `http://localhost:${apiPort}`,
      },
    },
  };
});
