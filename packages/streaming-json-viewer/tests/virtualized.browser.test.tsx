import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import { JsonViewer } from 'streaming-json-viewer';
import { settle } from './helpers/raf';

function Viewer({ value, virtualized }: { value: unknown; virtualized?: boolean }) {
  return (
    <JsonViewer.Root value={value} virtualized={virtualized}>
      <JsonViewer.Viewport
        style={{ width: 400, height: 200 }}
        data-testid="viewport"
      >
        <JsonViewer.Content>
          {() => (
            <JsonViewer.Group>
              {() => (
                <JsonViewer.Line>
                  <JsonViewer.LineContent />
                </JsonViewer.Line>
              )}
            </JsonViewer.Group>
          )}
        </JsonViewer.Content>
      </JsonViewer.Viewport>
    </JsonViewer.Root>
  );
}

// Top-level array of 200 small numbers. The user array becomes one open row
// (treeitem), 200 item rows, and one close row (aria-hidden / not a treeitem),
// for 201 treeitems and a 202-line document (~4444 px at ROW_HEIGHT=22).
function makeBigArray(count = 200): number[] {
  return Array.from({ length: count }, (_, i) => i);
}
const TOTAL_TREEITEMS = 201;
const SPACER_HEIGHT = 202 * 22;

describe('virtualized prop', () => {
  test('virtualized={true}: only a windowed slice mounts', async () => {
    const screen = await render(<Viewer value={makeBigArray(200)} virtualized />);
    await settle();
    const viewport = screen.getByTestId('viewport').element() as HTMLDivElement;
    const rows = viewport.querySelectorAll('[role="treeitem"]');
    // Viewport fits ~9 rows; with overscan=12 on each side we expect well under
    // the total of 200.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(60);
  });

  test('virtualized={false}: every row is in the DOM', async () => {
    const screen = await render(<Viewer value={makeBigArray(200)} virtualized={false} />);
    await settle();
    const viewport = screen.getByTestId('viewport').element() as HTMLDivElement;
    const rows = viewport.querySelectorAll('[role="treeitem"]');
    expect(rows.length).toBe(TOTAL_TREEITEMS);
  });

  test('default is non-virtualized', async () => {
    const screen = await render(<Viewer value={makeBigArray(200)} />);
    await settle();
    const viewport = screen.getByTestId('viewport').element() as HTMLDivElement;
    const rows = viewport.querySelectorAll('[role="treeitem"]');
    expect(rows.length).toBe(TOTAL_TREEITEMS);
  });

  test('virtualized={false}: spacer is the natural document height', async () => {
    const screen = await render(<Viewer value={makeBigArray(200)} virtualized={false} />);
    await settle();
    const viewport = screen.getByTestId('viewport').element() as HTMLDivElement;
    const spacer = viewport.firstElementChild as HTMLDivElement;
    expect(parseFloat(spacer.style.height)).toBe(SPACER_HEIGHT);
  });

  test('virtualized={false}: collapsing a container removes its descendants from the DOM', async () => {
    const screen = await render(
      <Viewer
        value={{ outer: { a: 1, b: 2, c: 3 }, sibling: 'kept' }}
        virtualized={false}
      />,
    );
    await settle();
    const viewport = screen.getByTestId('viewport').element() as HTMLDivElement;
    const before = viewport.querySelectorAll('[role="treeitem"]').length;
    // Click the `outer` open row to collapse it.
    const outer = Array.from(
      viewport.querySelectorAll<HTMLElement>('[role="treeitem"]'),
    ).find((el) => el.textContent?.includes('outer'));
    expect(outer).toBeTruthy();
    await userEvent.click(outer!);
    await settle();
    const after = viewport.querySelectorAll('[role="treeitem"]').length;
    expect(after).toBeLessThan(before);
  });
});
