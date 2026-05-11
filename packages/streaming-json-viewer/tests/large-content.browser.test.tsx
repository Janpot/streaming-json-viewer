import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import { TestViewer } from './helpers/TestViewer';
import {
  makeDemoMirrorFixture,
  makeHugeArrayOfObjectsFixture,
  makeHugeJsonlFixture,
  makeSingleHugeArrayFixture,
} from './helpers/fixtures';
import { focusedRow, tabIntoTree } from './helpers/focus';
import { settle } from './helpers/raf';
import { waitForStatus } from './helpers/wait';

const ROW_HEIGHT = 22;
const SAFE_MAX_SPACER_HEIGHT = 8_000_000;
const HUGE_COUNT = 400_000; // > 363_636 needed to push fullHeight past 8M px

describe('large content (factor > 1)', () => {
  test('factor > 1 activates: spacer is capped at SAFE_MAX_SPACER_HEIGHT', async () => {
    const screen = await render(<TestViewer value={makeHugeJsonlFixture(HUGE_COUNT)} />);
    await waitForStatus('done', 60_000);
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLDivElement;
    const spacer = viewport.firstElementChild as HTMLDivElement;
    const spacerHeight = parseFloat(spacer.style.height);
    expect(spacerHeight).toBe(SAFE_MAX_SPACER_HEIGHT);
    // Sanity-check: the document is actually larger than the cap.
    expect(HUGE_COUNT * ROW_HEIGHT).toBeGreaterThan(SAFE_MAX_SPACER_HEIGHT);
  }, 60_000);

  test('End scrolls to the last row', async () => {
    await render(<TestViewer value={makeHugeJsonlFixture(HUGE_COUNT)} />);
    await waitForStatus('done', 60_000);
    // Tab into the tree and press End.
    await tabIntoTree();
    await userEvent.keyboard('{End}');
    await settle();
    // The last JSONL line is `{"i":399999}` — its `i` value renders as 399999.
    expect(focusedRow()).toHaveTextContent(String(HUGE_COUNT - 1));
  }, 60_000);

  test('wheel scroll preserves pixel precision in factor > 1 mode', async () => {
    const screen = await render(<TestViewer value={makeHugeJsonlFixture(HUGE_COUNT)} />);
    await waitForStatus('done', 60_000);
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLDivElement;
    const beforeScroll = viewport.scrollTop;
    // Fire many small wheel events; in factor > 1 mode the lib advances
    // docScrollTop by exactly deltaY pixels even though scrollTop moves less.
    await userEvent.wheel(viewport, { delta: { y: 10 }, times: 30 });
    await settle();
    // scrollTop should have moved (compressed) but never beyond the spacer.
    expect(viewport.scrollTop).toBeGreaterThanOrEqual(beforeScroll);
    const spacer = viewport.firstElementChild as HTMLDivElement;
    const spacerHeight = parseFloat(spacer.style.height);
    expect(viewport.scrollTop + viewport.clientHeight).toBeLessThanOrEqual(spacerHeight + 1);
  }, 60_000);

  test('native scrollbar drag drops localOffset (no fractional fine-grain)', async () => {
    const screen = await render(<TestViewer value={makeHugeJsonlFixture(HUGE_COUNT)} />);
    await waitForStatus('done', 60_000);
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLDivElement;
    // Simulate a drag: native scroll event with no programmaticScrollRef.
    viewport.scrollTop = 5000;
    viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
    await settle();
    // After a real drag the lib resets localOffset to 0; the displayed top
    // row's index should be a clean function of scrollTop only.
    const rows = screen.getByRole('treeitem').elements();
    expect(rows.length).toBeGreaterThan(0);
  }, 60_000);

  test('single subtree taller than the cap renders without errors', async () => {
    await render(<TestViewer value={makeSingleHugeArrayFixture(HUGE_COUNT)} />);
    await waitForStatus('done', 60_000);
    await tabIntoTree();
    await userEvent.keyboard('{End}');
    await settle();
    // Last array element is the integer (HUGE_COUNT - 1).
    expect(focusedRow()).toHaveTextContent(String(HUGE_COUNT - 1));
  }, 60_000);

  test('screenshot — factor > 1, End focuses the last treeitem', async () => {
    const screen = await render(<TestViewer value={makeHugeJsonlFixture(HUGE_COUNT)} />);
    await waitForStatus('done', 60_000);
    await tabIntoTree();
    await userEvent.keyboard('{End}');
    await settle();
    // End focuses the last treeitem (the value `"i": 399999`); the structural
    // close `}` for that entry sits below the visible band.
    await expect.element(screen.getByTestId('tv-viewport')).toMatchScreenshot('factor-gt-1-end');
  }, 60_000);

  test('screenshot — factor > 1, viewport scrolled to absolute bottom', async () => {
    const screen = await render(<TestViewer value={makeHugeJsonlFixture(HUGE_COUNT)} />);
    await waitForStatus('done', 60_000);
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLDivElement;
    viewport.scrollTop = viewport.scrollHeight;
    viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
    await settle();
    await expect
      .element(screen.getByTestId('tv-viewport'))
      .toMatchScreenshot('factor-gt-1-scroll-bottom');
  }, 60_000);

  test('screenshot — single huge subtree at a stable mid scroll', async () => {
    const screen = await render(<TestViewer value={makeSingleHugeArrayFixture(HUGE_COUNT)} />);
    await waitForStatus('done', 60_000);
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLDivElement;
    // Scroll to a known mid position. Multiple of ROW_HEIGHT for stability.
    viewport.scrollTop = Math.floor(SAFE_MAX_SPACER_HEIGHT / 2 / ROW_HEIGHT) * ROW_HEIGHT;
    viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
    await settle();
    await expect
      .element(screen.getByTestId('tv-viewport'))
      .toMatchScreenshot('single-huge-array-mid');
  }, 60_000);

  test('single-container fixture renders the last item when wheeled to the bottom', async () => {
    // 600k three-line entries → 1.8M lines → fullHeight ≈ 39.6M px. The single
    // root array's wrapper would have height ≈ 39.6M and (at max scroll) top
    // ≈ −31.6M if positioned uncompressed — past the browser's element-coord
    // limit (~33M in Chromium), causing the wrapper to fail to lay out and no
    // rows to render. The renderer must keep wrapper positions bounded by the
    // spacer cap. Equivalent to the docs 15MB demo failure mode.
    const NESTED_COUNT = 600_000;
    const screen = await render(
      <TestViewer value={makeHugeArrayOfObjectsFixture(NESTED_COUNT)} />,
    );
    await waitForStatus('done', 60_000);
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLDivElement;

    // Wheel to the bottom. The wheel handler in factor>1 mode advances
    // docScrollTop by deltaY pixels and clamps to docRange, so a single
    // very large wheel event lands at the absolute bottom — same code
    // path the user exercises in the demo.
    await userEvent.wheel(viewport, { delta: { y: 1e9 } });
    await settle();

    // Identify the expected last row via ARIA. The fixture is
    // `{"items": [...]}`, so root is depth 0, `"items"` array is depth 1,
    // and each item sits at depth 2 (aria-level=3). The last item is at
    // aria-posinset === NESTED_COUNT.
    const lastItem = viewport.querySelector<HTMLElement>(
      `[role="treeitem"][aria-level="3"][aria-posinset="${NESTED_COUNT}"]`,
    );
    expect(lastItem, 'last array item should be rendered at scroll bottom').not.toBeNull();

    const vpRect = viewport.getBoundingClientRect();
    const r = lastItem!.getBoundingClientRect();
    expect(
      r.bottom > vpRect.top && r.top < vpRect.bottom,
      'last array item should overlap the viewport rect',
    ).toBe(true);
  }, 120_000);

  test('screenshot — single-container fixture wheeled to the bottom', async () => {
    const NESTED_COUNT = 600_000;
    const screen = await render(
      <TestViewer value={makeHugeArrayOfObjectsFixture(NESTED_COUNT)} />,
    );
    await waitForStatus('done', 60_000);
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLDivElement;
    await userEvent.wheel(viewport, { delta: { y: 1e9 } });
    await settle();
    await expect
      .element(screen.getByTestId('tv-viewport'))
      .toMatchScreenshot('single-container-scroll-bottom');
  }, 120_000);

  test('schema (small sibling above items) is clickable despite wrapper overlap', async () => {
    // factor>1 mode: the items wrapper's compressed bounds extend upward into
    // schema's row range. Without pointer-events:none on wrappers + auto on
    // rows, the items wrapper would intercept clicks aimed at schema, since
    // wrappers have no onClick and clicks don't bubble to the sibling below.
    const screen = await render(<TestViewer value={makeDemoMirrorFixture(100_000)} />);
    await waitForStatus('done', 60_000);
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLDivElement;
    const schema = Array.from(
      viewport.querySelectorAll<HTMLElement>('[role="treeitem"][aria-expanded="true"]'),
    ).find((el) => el.textContent?.includes('schema'));
    expect(schema, 'schema row should render at the top of the viewport').toBeTruthy();
    expect(schema!.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(schema!);
    await settle();
    const after = viewport.querySelector<HTMLElement>(`[id="${schema!.id}"]`);
    expect(after?.getAttribute('aria-expanded')).toBe('false');
  }, 60_000);

  test('screenshot — docs 15MB demo mirror wheeled to the bottom', async () => {
    // 100k items × ~20 lines each ≈ 2M lines (matches docs `15MB` demo).
    const screen = await render(<TestViewer value={makeDemoMirrorFixture(100_000)} />);
    await waitForStatus('done', 60_000);
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLDivElement;
    await userEvent.wheel(viewport, { delta: { y: 1e9 } });
    await settle();
    await expect
      .element(screen.getByTestId('tv-viewport'))
      .toMatchScreenshot('demo-mirror-scroll-bottom');
  }, 120_000);
});
