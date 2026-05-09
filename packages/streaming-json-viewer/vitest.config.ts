import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      'streaming-json-viewer': resolve(__dirname, './src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.browser.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 15_000,
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      viewport: { width: 1024, height: 720 },
      instances: [{ browser: 'chromium' }],
      expect: {
        toMatchScreenshot: {
          comparatorName: 'pixelmatch',
          comparatorOptions: {
            threshold: 0.1,
            allowedMismatchedPixelRatio: 0.015,
          },
        },
      },
    },
  },
});
