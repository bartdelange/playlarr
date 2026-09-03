import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@playlarr/shared-database',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'],
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
