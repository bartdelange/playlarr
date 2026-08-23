import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../../node_modules/.vite/libs/features/home',
  plugins: [react()],
  test: {
    name: 'feature-home',
    watch: false,
    passWithNoTests: true,
    globals: true,
    environment: 'jsdom',
    setupFiles: ['../../../vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default', 'junit'],
    outputFile: {
      junit: './test-output/vitest/reports/junit.xml',
    },
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8',
    },
  },
});
