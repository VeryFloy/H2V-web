import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import compression from 'vite-plugin-compression';

export default defineConfig({
  plugins: [
    solid(),
    compression({ algorithm: 'gzip', threshold: 1024 }),
    compression({ algorithm: 'brotliCompress', threshold: 1024, ext: '.br' }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3000', changeOrigin: true },
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'solid-vendor': ['solid-js', 'solid-js/web', 'solid-js/store'],
          'virtual': ['@tanstack/solid-virtual'],
        },
      },
    },
  },
});
