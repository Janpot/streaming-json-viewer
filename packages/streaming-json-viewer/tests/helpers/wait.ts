import { expect } from 'vitest';
import { page } from 'vitest/browser';
import type { Status } from 'streaming-json-viewer/streaming';

/**
 * Waits until the test viewer's status chip carries `data-status={expected}`.
 * Asserting on the attribute instead of rendered text decouples tests from
 * the user-rendered status label.
 */
export async function waitForStatus(expected: Status, timeout = 10_000) {
  const status = page.getByTestId('tv-status');
  await expect.element(status, { timeout }).toHaveAttribute('data-status', expected);
}
