import { defineConfig } from 'tsup';

// Production build: bitta ESM paket, workspace paketlari ichiga qo'shiladi, npm bog'liqliklar tashqarida
// (server'da `pnpm install --prod` bilan o'rnatiladi).
export default defineConfig({
  entry: {
    main: 'src/main.ts',
    migrate: 'src/db/migrate-cli.ts',
    'webhook-cli': 'src/bot/webhook-cli.ts',
  },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: ['@nasiya/shared'],
});
