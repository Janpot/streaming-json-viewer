import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { JsonViewer } from 'streaming-json-viewer';

/**
 * Bare composition — no streaming hook, no status bar. Exercises the sync
 * auto-wrap path inside `<Root>` (i.e., `ParsedJson.from(value)`).
 */
function Viewer({ value }: { value: unknown }) {
  return (
    <JsonViewer.Root value={value}>
      <JsonViewer.Viewport style={{ width: 400, height: 200 }} data-testid="viewport">
        <JsonViewer.Body>
          {() => (
            <JsonViewer.Group>
              {() => (
                <JsonViewer.Line>
                  <JsonViewer.LineContent />
                </JsonViewer.Line>
              )}
            </JsonViewer.Group>
          )}
        </JsonViewer.Body>
      </JsonViewer.Viewport>
    </JsonViewer.Root>
  );
}

describe('top-level primitives', () => {
  test('string renders one row', async () => {
    const screen = await render(<Viewer value="hello" />);
    const row = screen.getByRole('treeitem');
    await expect.element(row).toHaveAttribute('data-type', 'string');
    await expect.element(row).toHaveTextContent('"hello"');
  });

  test('number renders one row', async () => {
    const screen = await render(<Viewer value={42} />);
    const row = screen.getByRole('treeitem');
    await expect.element(row).toHaveAttribute('data-type', 'number');
    await expect.element(row).toHaveTextContent('42');
  });

  test('boolean true renders one row', async () => {
    const screen = await render(<Viewer value={true} />);
    const row = screen.getByRole('treeitem');
    await expect.element(row).toHaveAttribute('data-type', 'boolean');
    await expect.element(row).toHaveTextContent('true');
  });

  test('boolean false renders one row', async () => {
    const screen = await render(<Viewer value={false} />);
    const row = screen.getByRole('treeitem');
    await expect.element(row).toHaveAttribute('data-type', 'boolean');
    await expect.element(row).toHaveTextContent('false');
  });

  test('null renders one row', async () => {
    const screen = await render(<Viewer value={null} />);
    const row = screen.getByRole('treeitem');
    await expect.element(row).toHaveAttribute('data-type', 'null');
    await expect.element(row).toHaveTextContent('null');
  });

  test('undefined renders an empty viewer', async () => {
    const screen = await render(<Viewer value={undefined} />);
    expect(screen.getByRole('treeitem').elements()).toHaveLength(0);
  });
});
