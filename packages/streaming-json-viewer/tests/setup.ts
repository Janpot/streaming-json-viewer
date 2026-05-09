import { afterEach, beforeEach } from 'vitest';
import { cleanup } from 'vitest-browser-react';
import './test-styles.css';

const FONTS_TIMEOUT_MS = 3_000;

beforeEach(async () => {
  await Promise.race([
    document.fonts.ready,
    new Promise<void>((r) => setTimeout(r, FONTS_TIMEOUT_MS)),
  ]);
});

afterEach(async () => {
  await cleanup();
});
