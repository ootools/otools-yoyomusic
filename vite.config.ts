import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// OTools 插件：web/ 是 Vite 源码根，构建产物输出到仓库根的 dist/（plugin.json entry 指向 dist/index.html）。
// dev 端口 6482 strictPort 对齐 plugin.json 的 devUrl（见设计文档 §11 本地联调）。
export default defineConfig({
  root: 'web',
  base: './',
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 6482,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    outDir: '../dist',
    emptyOutDir: true,
  },
});
