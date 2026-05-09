import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { TestViewer } from './helpers/TestViewer';
import { makeMediumFixture, makeSmallFixture } from './helpers/fixtures';
import { controlledStream } from './helpers/streams';
import { waitForStatus } from './helpers/wait';

describe('streaming', () => {
  test('idle state when value is null', async () => {
    const screen = await render(<TestViewer value={null} />);
    const status = screen.getByTestId('tv-status');
    await expect.element(status).toHaveTextContent('idle');
    const tree = screen.getByRole('tree');
    await expect.element(tree).not.toHaveAttribute('aria-busy');
  });

  test('idle → streaming → done transition with aria-busy', async () => {
    const text = makeMediumFixture();
    const half = Math.floor(text.length / 2);
    const ctrl = controlledStream();
    const screen = await render(<TestViewer value={ctrl.stream} />);
    const tree = screen.getByRole('tree');
    const status = screen.getByTestId('tv-status');
    ctrl.push(text.slice(0, half));
    await expect.element(status).toHaveTextContent('streaming');
    await expect.element(tree).toHaveAttribute('aria-busy', 'true');
    ctrl.push(text.slice(half));
    ctrl.end();
    await waitForStatus('done');
    await expect.element(status).toHaveTextContent('complete');
    await expect.element(tree).not.toHaveAttribute('aria-busy');
  });

  test('bytes counter ends at fixture length', async () => {
    const text = makeSmallFixture();
    const screen = await render(<TestViewer value={text} />);
    await waitForStatus('done');
    await expect
      .element(screen.getByTestId('tv-bytes'))
      .toHaveTextContent(text.length.toLocaleString());
  });

  test('error status on invalid JSON', async () => {
    const screen = await render(<TestViewer value={'{ this is not json'} />);
    await waitForStatus('error');
    await expect.element(screen.getByTestId('tv-status')).toHaveAttribute('data-status', 'error');
  });

  test('swapping value resets and re-parses', async () => {
    const a = JSON.stringify({ alpha: 1, betaA: 2 });
    const b = JSON.stringify({ gamma: 3, deltaB: 4 });
    const screen = await render(<TestViewer value={a} />);
    await waitForStatus('done');
    await expect.element(screen.getByRole('treeitem', { name: /alpha/ })).toBeVisible();

    await screen.rerender(<TestViewer value={b} />);
    await waitForStatus('done');
    await expect.element(screen.getByRole('treeitem', { name: /gamma/ })).toBeVisible();
    await expect.element(screen.getByRole('treeitem', { name: /deltaB/ })).toBeVisible();
    expect(screen.getByRole('treeitem', { name: /alpha/ }).elements()).toHaveLength(0);
  });

  test('null value clears tree and returns to idle', async () => {
    const screen = await render(<TestViewer value={makeSmallFixture()} />);
    await waitForStatus('done');
    expect(screen.getByRole('treeitem').elements().length).toBeGreaterThan(0);

    await screen.rerender(<TestViewer value={null} />);
    await waitForStatus('idle');
    expect(screen.getByRole('treeitem').elements()).toHaveLength(0);
  });
});
