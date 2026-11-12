import { defineConfig } from 'vitest/config';

// 只收 web/ 源码里的单测；scripts/*.test.mjs 是 node:test 风格（CI 里跑
// `node --test scripts/*.test.mjs`），不归 vitest 管。
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['web/src/**/*.{test,spec}.{ts,tsx}'],
  },
});
