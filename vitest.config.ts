import { defineConfig } from 'vitest/config';

// 后端单测/集成测：仅跑 src/shared 下的 *.test.ts（纯 TS + Hono app.fetch，无前端）。
// vitest 懂 tsconfig 的相对 import 解析（含 .js 说明符指向 .ts 源），故不再受
// node --test 原生跑器「扩展名三方打架」的限制（见本轮改造说明）。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/shared/**/*.test.ts'],
    globals: false,
  },
});
