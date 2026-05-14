import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import { TestViewer } from './helpers/TestViewer';
import { accessibleText } from './helpers/aria';
import { makeMediumFixture } from './helpers/fixtures';
import { focusedRow, tabIntoTree } from './helpers/focus';
import { controlledStream } from './helpers/streams';
import { waitForStatus } from './helpers/wait';

describe('accessibility', () => {
  test('viewport has role=tree and accessible name', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    await expect.element(screen.getByRole('tree', { name: 'JSON tree' })).toBeVisible();
  });

  test('aria-busy is true while streaming and absent when done', async () => {
    const text = makeMediumFixture();
    const half = Math.floor(text.length / 2);
    const ctrl = controlledStream();
    const screen = await render(<TestViewer value={ctrl.stream} />);
    const tree = screen.getByRole('tree');
    ctrl.push(text.slice(0, half));
    await expect.element(tree).toHaveAttribute('aria-busy', 'true');
    ctrl.push(text.slice(half));
    ctrl.end();
    await waitForStatus('done');
    await expect.element(tree).not.toHaveAttribute('aria-busy');
  });

  test('every visible open row appears as a treeitem', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    const treeitems = screen.getByRole('treeitem').elements();
    expect(treeitems.length).toBeGreaterThan(0);
  });

  test('clicking a container toggles aria-expanded and hides/shows its descendants', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    const usersRow = screen.getByRole('treeitem', { name: /users/ });
    // `id` keys only exist on descendants of users — a load-bearing proxy for
    // "the subtree is rendered".
    const idRows = screen.getByRole('treeitem', { name: /id/ });
    await expect.element(usersRow).toHaveAttribute('aria-expanded', 'true');
    expect(idRows.elements().length).toBeGreaterThan(0);

    await userEvent.click(usersRow);
    await expect.element(usersRow).toHaveAttribute('aria-expanded', 'false');
    expect(idRows.elements()).toHaveLength(0);

    await userEvent.click(usersRow);
    await expect.element(usersRow).toHaveAttribute('aria-expanded', 'true');
    expect(idRows.elements().length).toBeGreaterThan(0);
  });

  test('primitive rows do not have aria-expanded', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    const titleRow = screen.getByRole('treeitem', { name: /title/ });
    await expect.element(titleRow).not.toHaveAttribute('aria-expanded');
  });

  test('aria-level reflects nesting depth', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    // Top-level keys (`title`, `users`) live one level inside the root object.
    const titleRow = screen.getByRole('treeitem', { name: /title/ });
    await expect.element(titleRow).toHaveAttribute('aria-level', '2');
    const usersRow = screen.getByRole('treeitem', { name: /users/ });
    await expect.element(usersRow).toHaveAttribute('aria-level', '2');
    // Each user object is inside the users array, one level deeper.
    const firstUserObject = screen.getByRole('treeitem').filter({ hasText: '4 keys' }).first();
    await expect.element(firstUserObject).toHaveAttribute('aria-level', '3');
  });

  test('aria-setsize and aria-posinset reflect siblings', async () => {
    // Tall viewer so all 5 user objects render without virtualization clipping.
    const screen = await render(<TestViewer value={makeMediumFixture()} height={1400} />);
    await waitForStatus('done');
    // The users array's siblings are { title, users } → setsize=2, posinset=2.
    const usersRow = screen.getByRole('treeitem', { name: /users/ });
    await expect.element(usersRow).toHaveAttribute('aria-setsize', '2');
    await expect.element(usersRow).toHaveAttribute('aria-posinset', '2');
    // Each user object is one of 5 in the users array.
    const userObjects = screen.getByRole('treeitem').filter({ hasText: '4 keys' });
    expect(userObjects.elements()).toHaveLength(5);
    const third = userObjects.nth(2);
    await expect.element(third).toHaveAttribute('aria-setsize', '5');
    await expect.element(third).toHaveAttribute('aria-posinset', '3');
  });

  test('every aria-hidden row is also role=presentation', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLElement;
    // Close rows are the only aria-hidden rows the viewer emits. Walking by
    // aria-hidden (rather than a structural marker) checks the contract from
    // the AT's perspective: anything hidden from it must also have a
    // presentation role so it is fully excluded from the tree.
    const hiddenRows = viewport.querySelectorAll('div[aria-hidden="true"]');
    expect(hiddenRows.length).toBeGreaterThan(0);
    for (const el of Array.from(hiddenRows)) {
      expect(el.getAttribute('role')).toBe('presentation');
    }
  });

  test('exactly one row holds tabindex=0 (roving tabindex)', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLElement;
    const tabbable = viewport.querySelectorAll('[tabindex="0"]');
    expect(tabbable.length).toBe(1);
  });

  test('Tab restores the previously focused row when re-entering the tree', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} withTrailingButton />);
    await waitForStatus('done');

    // Tab into the tree — lands on the roving tab stop (the root row).
    await tabIntoTree();

    // Move focus to a different row so the roving tab stop migrates with it.
    await userEvent.keyboard('{ArrowDown}');
    const remembered = focusedRow();

    // Tab out of the tree onto the trailing button.
    await userEvent.tab();
    await expect.element(screen.getByTestId('trailing-button')).toHaveFocus();

    // Shift+Tab back into the tree — focus must land on the same row, not
    // reset to the root.
    await userEvent.tab({ shift: true });
    expect(focusedRow()).toBe(remembered);
  });

  test('Status reflects state across idle / streaming / done / error', async () => {
    const screen = await render(<TestViewer value={null} />);
    const status = screen.getByTestId('tv-status');
    await expect.element(status).toHaveTextContent('idle');

    const text = makeMediumFixture();
    const ctrl = controlledStream();
    await screen.rerender(<TestViewer value={ctrl.stream} />);
    ctrl.push(text.slice(0, Math.floor(text.length / 2)));
    await expect.element(status).toHaveTextContent('streaming');
    ctrl.push(text.slice(Math.floor(text.length / 2)));
    ctrl.end();
    await waitForStatus('done');
    await expect.element(status).toHaveTextContent('done');

    await screen.rerender(<TestViewer value={'{ not json'} />);
    await waitForStatus('error');
    await expect.element(status).toHaveAttribute('data-status', 'error');
  });

  test('accessible names exclude brackets, colons, and ellipsis', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    const treeitems = screen.getByRole('treeitem').elements();
    expect(treeitems.length).toBeGreaterThan(0);
    for (const el of treeitems) {
      const name = accessibleText(el);
      expect(name, `treeitem accessible name: ${JSON.stringify(name)}`).not.toMatch(/[{}[\]…]/);
      // colon is rendered in an aria-hidden span and must not appear either
      expect(name).not.toContain(':');
    }
  });

  test('container accessible name keeps key and count, drops brackets', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    const usersEl = screen
      .getByRole('treeitem', { name: /users/ })
      .element() as HTMLElement;
    const name = accessibleText(usersEl);
    expect(name).toContain('"users"');
    expect(name).toContain('5 items');
    expect(name).not.toMatch(/[{}[\]:…]/);
  });
});
