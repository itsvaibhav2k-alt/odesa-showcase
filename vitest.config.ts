import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    exclude: [
      'tests/e2e/**',
      'e2e/**',
      'node_modules/**',
      '.claude/**',
      '.next/**',
      // Artifact dirs that hold Playwright specs / scratch code, never unit
      // tests. Without these, vitest mis-collects e.g. the QA scale
      // reproducer (qa-output/**/portfolio-scale.spec.ts) and fails
      // collection with "Playwright Test did not expect test.describe()".
      'qa-output/**',
      '.hermes/**',
      'design/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'tests/', '.next/'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
