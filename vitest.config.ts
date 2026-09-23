import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: '.',
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 10000,
    css: false,
  },
  css: {
    postcss: false,
  },
});
