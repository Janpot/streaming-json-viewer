import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import { TestViewer } from './helpers/TestViewer';
import { makeDeeplyNestedFixture, makeMediumFixture, makePushUpFixture } from './helpers/fixtures';
import { waitForStatus } from './helpers/wait';

const ROW_HEIGHT = 22;

async function settle() {
  // Allow scroll → React state update → DOM commit.
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await new Promise((r) => requestAnimationFrame(() => r(null)));
}

describe('sticky headers', () => {
  test('no row is marked data-sticky at rest (scrollTop=0)', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} height={300} />);
    await waitForStatus('done');
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLDivElement;
    expect(viewport.scrollTop).toBe(0);
    expect(viewport.querySelectorAll('[data-sticky]').length).toBe(0);
    expect(viewport.querySelectorAll('[data-sticky-last]').length).toBe(0);
  });

  test('root row picks up data-sticky once scrolled past its natural top', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} height={300} />);
    await waitForStatus('done');
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLDivElement;
    viewport.scrollTop = ROW_HEIGHT;
    viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
    await settle();
    expect(viewport.querySelectorAll('[data-sticky]').length).toBeGreaterThan(0);
  });

  test('depth>0 sticky ancestor gets data-sticky the moment CSS pinning fires', async () => {
    // `users` is at lineIdx=2, depth=1 → CSS sticky pins it at docScrollTop > 22.
    // A naive `lineIdx*ROW_HEIGHT < scrollTop` threshold delays data-sticky
    // until docScrollTop > 44, leaving a 22px gap where the row sticks
    // visually but renders unstyled.
    const screen = await render(<TestViewer value={makeMediumFixture()} height={300} />);
    await waitForStatus('done');
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLDivElement;
    viewport.scrollTop = ROW_HEIGHT + 5; // 27 — inside the gap.
    viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
    await settle();
    const stickyLevels = Array.from(viewport.querySelectorAll<HTMLElement>('[data-sticky]'))
      .map((el) => Number(el.getAttribute('aria-level')))
      .sort((a, b) => a - b);
    expect(stickyLevels).toContain(2);
  });

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

  // Gates the content-box clamp in the flow structure (auto-height wrapper +
  // close row negative margin + wrapper padding): with the wrapper's content
  // box ending at the close row's top, CSS sticky pushes the pinned header up
  // by exactly (ROW_HEIGHT − Δ) when the close row is Δ below the slot, so the
  // header is fully handed off exactly when the close reaches the slot (Δ=0).
  // If the engine clamped to the padding/border box instead, the negative
  // margin/padding pair would not move the trigger and mid/gone would fail.
  // `delta` here = closeRow.top − slot.
  test('sticky header is pushed up by exactly the close-row overlap', async () => {
    const RH = ROW_HEIGHT;
    // makePushUpFixture(): `head` array open=line 1 (depth 1), close=line 42.
    const d = 1;
    const cl = 42;
    const screen = await render(<TestViewer value={makePushUpFixture()} height={300} />);
    await waitForStatus('done');
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLDivElement;

    const headRelTop = async (delta: number): Promise<number> => {
      // Put `head`'s close row at `slot + delta` from the viewport top.
      viewport.scrollTop = cl * RH - d * RH - delta;
      viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
      await settle();
      const header = Array.from(
        viewport.querySelectorAll<HTMLElement>('[role="treeitem"]'),
      ).find((el) => el.querySelector('[data-token="property"]')?.textContent === '"head"');
      if (!header) throw new Error('head header not found');
      return header.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    };

    const slot = d * RH;
    const pinned2 = await headRelTop(2 * RH); // close 2 rows below → fully pinned
    const pinned1 = await headRelTop(RH); // close exactly 1 row below → still pinned
    const mid = await headRelTop(RH / 2); // close ½ row below → pushed up RH/2
    const gone = await headRelTop(0); // close at the slot → fully handed off

    expect(Math.abs(pinned2 - slot)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(pinned1 - slot)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(mid - (slot - RH / 2))).toBeLessThanOrEqual(1.5);
    expect(Math.abs(gone - (slot - RH))).toBeLessThanOrEqual(1.5);
    // Essence of the gate: the close row actually drives the push-up.
    expect(pinned2 - mid).toBeGreaterThanOrEqual(RH / 2 - 1.5);
  });
});
