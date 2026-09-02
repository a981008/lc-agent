import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 开发模式（npm run dev）：Vite 独立端口 5173，/api 与 /ws 代理到后端 3081
// 生产模式（npm run build）：产物输出 dist/，由后端 express 静态服务
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3081', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:3081', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
