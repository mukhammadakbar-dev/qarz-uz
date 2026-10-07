import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['apps/**/*.test.ts', 'packages/**/*.test.{ts,mjs}'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/*.int.test.ts'],
        },
      },
      {
        // Real PostgreSQL kerak: `scripts/dev-db.sh up`. Fayllar ketma-ket ishlaydi (umumiy DB).
        test: {
          name: 'int',
          include: ['apps/**/*.int.test.ts'],
          globalSetup: ['./apps/server/test/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
