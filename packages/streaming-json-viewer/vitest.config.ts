import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { playwright } from '@vitest/browser-playwright';
import {
  dockerizedPlaywright,
  resolveDockerDiffPath,
  resolveDockerScreenshotPath,
} from './tools/dockerized-playwright';

// CI runs *inside* the pinned Playwright image (see .github/workflows/test.yml)
// — Chromium is already present and there is no Docker CLI, so it uses the
// plain host provider. Locally (macOS/Windows) the dockerized provider renders
// under the same Linux Chromium so screenshots match. Set
// `SJV_TEST_BROWSER=host` to force the host browser anywhere.
const useHostBrowser = process.env.SJV_TEST_BROWSER === 'host';

export default defineConfig({
  resolve: {
    alias: {
      'streaming-json-viewer/streaming': resolve(__dirname, './src/streaming.ts'),
      'streaming-json-viewer': resolve(__dirname, './src/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.browser.test.{ts,tsx}'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 15_000,
    browser: {
      enabled: true,
      provider: useHostBrowser
        ? playwright()
        : dockerizedPlaywright({
            image: process.env.SJV_DOCKER_IMAGE,
            debug: Boolean(process.env.SJV_DOCKER_DEBUG),
          }),
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
          resolveScreenshotPath: resolveDockerScreenshotPath,
          resolveDiffPath: resolveDockerDiffPath,
        },
      },
    },
  },
});
