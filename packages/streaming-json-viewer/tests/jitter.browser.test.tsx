import { describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { TestViewer } from './helpers/TestViewer';
import { controlledStream } from './helpers/streams';
import { settle } from './helpers/raf';
import { waitForStatus } from './helpers/wait';

// Lower the spacer cap so we hit factor>1 mode with a small number of rows.
// Cap = 1000 px = ~45 rows. Two ~60-row chunks easily put `fullHeight` above
// the cap and keep `factor` drifting between chunks.
vi.mock('../src/constants', () => ({ SAFE_MAX_SPACER_HEIGHT: 1_000 }));

describe('streaming jitter (factor>1 with growing totalLines)', () => {
  test('row positions stay bit-stable as totalLines grows past the cap', async () => {
    const ctrl = controlledStream();
    const screen = await render(<TestViewer value={ctrl.stream} height={400} />);
    await waitForStatus('streaming');

    // Phase 1: feed enough rows to enter factor>1 mode. JSONL is the simplest
    // shape — each row is a single-line primitive at depth 0, so we exercise
    // the outermost-row positioning path.
    ctrl.push(
      Array.from({ length: 60 }, (_, i) => JSON.stringify({ i })).join('\n') + '\n',
    );
    await settle(4);

    const viewport = screen.getByTestId('tv-viewport').element() as HTMLDivElement;
    // Compare composed viewport-relative tops (what the user actually sees),
    // not inline `style.top` — that's relative to the row's wrapper and the
    // wrapper compresses with `factor`. The point of the float-positioning
    // fix is that the *composed* position is stable; the individual offsets
    // both move and cancel.
    const snap = () => {
      const vpTop = viewport.getBoundingClientRect().top;
      return new Map(
        Array.from(viewport.querySelectorAll<HTMLElement>('[role="treeitem"][id]')).map(
          (el) => [el.id, el.getBoundingClientRect().top - vpTop] as const,
        ),
      );
    };

    // Cause B (at scrollTop=0): factor drift across chunks must not shift
    // existing rows.
    const beforeAtTop = snap();
    expect(beforeAtTop.size).toBeGreaterThan(5);
    ctrl.push(
      Array.from({ length: 60 }, (_, i) => JSON.stringify({ i: i + 60 })).join('\n') + '\n',
    );
    await settle(4);
    const afterAtTop = snap();

    for (const [id, before] of beforeAtTop) {
      const after = afterAtTop.get(id);
      if (after !== undefined) {
        // Allow 1/64 px tolerance — that's the bounding-rect quantization
        // Blink applies. The pre-fix drift was 1+ pixels, easily caught.
        expect(after, `row ${id} drifted at scrollTop=0`).toBeCloseTo(before, 1);
      }
    }

    // Cause A: scroll mid-document, then grow further.
    viewport.scrollTop = 200;
    viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
    await settle(2);

    const beforeScrolled = snap();
    expect(beforeScrolled.size).toBeGreaterThan(5);
    ctrl.push(
      Array.from({ length: 60 }, (_, i) => JSON.stringify({ i: i + 120 })).join('\n') + '\n',
    );
    ctrl.end();
    await waitForStatus('done');
    await settle(4);
    const afterScrolled = snap();

    for (const [id, before] of beforeScrolled) {
      const after = afterScrolled.get(id);
      if (after !== undefined) {
        expect(after, `row ${id} drifted at scrollTop>0`).toBeCloseTo(before, 1);
      }
    }
  });
});
