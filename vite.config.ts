import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: './',
  plugins: [svelte()],
  // Prepared up front, so the first guide PDF opened in dev doesn't reload the page.
  optimizeDeps: { include: ['pdfjs-dist'] },
  test: {
    include: ['src/**/*.test.ts', 'tests/db/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
