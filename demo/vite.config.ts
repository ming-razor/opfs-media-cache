import { defineConfig } from 'vite';
export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: { output: { manualChunks: { 'hls-player': ['hls.js'], 'flv-player': ['flv.js'] } } }
  }
});
