import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import { TestViewer } from './helpers/TestViewer';
import { makeDeeplyNestedFixture, makeMediumFixture } from './helpers/fixtures';
import { waitForStatus } from './helpers/wait';

const ROW_HEIGHT = 22;

async function settle() {
  // Allow scroll → React state update → DOM commit.
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await new Promise((r) => requestAnimationFrame(() => r(null)));
}

describe('sticky headers', () => {
  test('outer container becomes sticky once scrolled past its open row', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} height={300} />);
    await waitForStatus('done');
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLDivElement;

    viewport.scrollTop = 5 * ROW_HEIGHT;
    await settle();

    const stickyRows = viewport.querySelectorAll('[data-sticky]');
    expect(stickyRows.length).toBeGreaterThan(0);
  });

  test('multiple containers pin at consecutive depths', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} height={300} />);
    await waitForStatus('done');
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLDivElement;

    // Scroll deep enough that root, users, and a user object all pin.
    viewport.scrollTop = 8 * ROW_HEIGHT;
    await settle();

    const stickyRows = Array.from(viewport.querySelectorAll<HTMLElement>('[data-sticky]'));
    expect(stickyRows.length).toBeGreaterThanOrEqual(2);

    // Each pinned row's aria-level corresponds to its depth+1; consecutive
    // pinned rows should have strictly increasing aria-level.
    const levels = stickyRows
      .map((el) => Number(el.getAttribute('aria-level')))
      .sort((a, b) => a - b);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBe(levels[i - 1]! + 1);
    }
  });

  test('data-sticky-last appears only on the deepest pinned row', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} height={300} />);
    await waitForStatus('done');
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLDivElement;
    viewport.scrollTop = 10 * ROW_HEIGHT;
    await settle();

    const stickyLast = viewport.querySelectorAll('[data-sticky-last]');
    // Either none (no rows pinned yet at the bottom) or exactly one.
    expect(stickyLast.length).toBeLessThanOrEqual(1);
    if (stickyLast.length === 1) {
      const all = Array.from(viewport.querySelectorAll<HTMLElement>('[data-sticky]'));
      const deepest = all.reduce((max, el) =>
        Number(el.getAttribute('aria-level')) > Number(max.getAttribute('aria-level')) ? el : max,
      );
      expect(stickyLast[0]).toBe(deepest);
    }
  });

  test('clicking a pinned sticky open container collapses while staying near its viewport y', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} height={300} />);
    await waitForStatus('done');
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLDivElement;
    viewport.scrollTop = 8 * ROW_HEIGHT;
    await settle();

    // Pick the deepest pinned row (it has children we can collapse). Sticky
    // toggle keeps the click position anchored at the row's viewport y.
    const stickyRows = Array.from(viewport.querySelectorAll<HTMLElement>('[data-sticky]'));
    expect(stickyRows.length).toBeGreaterThan(0);
    const pinned = stickyRows[stickyRows.length - 1]!;
    const pinnedId = pinned.id;
    const beforeTop = pinned.getBoundingClientRect().top;

    await userEvent.click(pinned);
    await settle();

    // After collapse the row may be re-rendered in a different position in the
    // DOM tree — re-query by id to get the current node.
    const after = document.getElementById(pinnedId)!;
    expect(after.getAttribute('aria-expanded')).toBe('false');
    const afterTop = after.getBoundingClientRect().top;
    expect(Math.abs(afterTop - beforeTop)).toBeLessThanOrEqual(ROW_HEIGHT * 1.5);
  });

  test('screenshot — stacked sticky chain', async () => {
    const screen = await render(<TestViewer value={makeDeeplyNestedFixture(8)} height={260} />);
    await waitForStatus('done');
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLDivElement;
    // Scroll to a position that pins several outer levels.
    viewport.scrollTop = 6 * ROW_HEIGHT;
    await settle();

    await expect
      .element(screen.getByTestId('tv-viewport'))
      .toMatchScreenshot('stacked-sticky-chain');
  });
});
