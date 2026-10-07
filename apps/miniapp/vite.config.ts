import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Mini App /app/ ostida xizmat qilinadi (server @fastify/static yoki nginx orqali).
export default defineConfig({
  base: '/app/',
  plugins: [react()],
  server: {
    port: 5173,
    // dev: API ni lokal serverga yo'naltiramiz (CORS kerak emas)
    proxy: { '/api': 'http://127.0.0.1:3100' },
  },
  build: { outDir: 'dist', sourcemap: false, target: 'es2022' },
});
