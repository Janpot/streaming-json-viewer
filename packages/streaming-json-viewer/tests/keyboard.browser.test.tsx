import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import { TestViewer } from './helpers/TestViewer';
import { makeMediumFixture } from './helpers/fixtures';
import { expectFocusedRow, focusedRow, tabIntoTree } from './helpers/focus';
import { waitForStatus } from './helpers/wait';

// Medium fixture shape (siblings/depth used to assert focus identity below):
//   {                                       level 1
//     title: "medium fixture",              level 2, posinset 1, setsize 2
//     users: [                              level 2, posinset 2, setsize 2
//       { id, name, address: {...}, tags: [...] }   level 3, setsize 5
//     ]
//   }

describe('keyboard', () => {
  test('ArrowDown from root open lands on title', async () => {
    await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    await tabIntoTree();
    expectFocusedRow({ level: 1 });
    await userEvent.keyboard('{ArrowDown}');
    expectFocusedRow({ property: 'title', level: 2, posinset: 1, setsize: 2 });
  });

  test('ArrowDown over a container boundary skips close rows', async () => {
    await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    await tabIntoTree();
    // Walk to the last visible child of user-1: root → title → users →
    // user-1 → id → name → address → city → zip → tags → tag-1-a → tag-1-b.
    // (address expands inline, so its two children are walked before tags.)
    for (let i = 0; i < 11; i++) await userEvent.keyboard('{ArrowDown}');
    expectFocusedRow({ textContains: 'tag-1-b' });
    await userEvent.keyboard('{ArrowDown}');
    // Crossing tag-1-b → user-2 jumps over close `]` of tags and close `}` of
    // user-1 (both role=presentation). user-2 is the second array element.
    expectFocusedRow({ level: 3, posinset: 2, setsize: 5 });
  });

  test('ArrowUp moves from users back to title', async () => {
    await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    await tabIntoTree();
    await userEvent.keyboard('{ArrowDown}'); // title
    await userEvent.keyboard('{ArrowDown}'); // users
    expectFocusedRow({ property: 'users', posinset: 2 });
    await userEvent.keyboard('{ArrowUp}');
    expectFocusedRow({ property: 'title', level: 2, posinset: 1, setsize: 2 });
  });

  test('ArrowRight on a collapsed container expands it', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    await tabIntoTree();
    await userEvent.keyboard('{ArrowDown}'); // title
    await userEvent.keyboard('{ArrowDown}'); // users
    const usersRow = screen.getByRole('treeitem', { name: /users/ });
    await expect.element(usersRow).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    await expect.element(usersRow).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(usersRow).toHaveAttribute('aria-expanded', 'true');
  });

  test('ArrowRight on an expanded container moves to first child', async () => {
    await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    await tabIntoTree();
    await userEvent.keyboard('{ArrowDown}'); // title
    await userEvent.keyboard('{ArrowDown}'); // users
    await userEvent.keyboard('{ArrowRight}');
    // First child of users is the first user object — array element, no key,
    // first of 5 siblings, level 3 inside the array.
    expectFocusedRow({ level: 3, posinset: 1, setsize: 5 });
  });

  test('ArrowRight on a primitive is a no-op', async () => {
    await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    await tabIntoTree();
    await userEvent.keyboard('{ArrowDown}'); // title (primitive)
    expectFocusedRow({ property: 'title', posinset: 1 });
    await userEvent.keyboard('{ArrowRight}');
    expectFocusedRow({ property: 'title', posinset: 1 });
  });

  test('ArrowLeft on an expanded container collapses it', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    await tabIntoTree();
    await userEvent.keyboard('{ArrowDown}'); // title
    await userEvent.keyboard('{ArrowDown}'); // users
    const usersRow = screen.getByRole('treeitem', { name: /users/ });
    await expect.element(usersRow).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{ArrowLeft}');
    await expect.element(usersRow).toHaveAttribute('aria-expanded', 'false');
  });

  test('ArrowLeft on a collapsed container moves to parent', async () => {
    await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    await tabIntoTree();
    await userEvent.keyboard('{ArrowDown}'); // title
    await userEvent.keyboard('{ArrowDown}'); // users
    await userEvent.keyboard('{ArrowLeft}'); // collapse users
    await userEvent.keyboard('{ArrowLeft}'); // move to parent (root `{`)
    expectFocusedRow({ level: 1 });
  });

  test('ArrowLeft on a primitive moves to parent', async () => {
    await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    await tabIntoTree();
    await userEvent.keyboard('{ArrowDown}'); // title (primitive)
    expectFocusedRow({ property: 'title', level: 2 });
    await userEvent.keyboard('{ArrowLeft}');
    expectFocusedRow({ level: 1 });
  });

  test('ArrowLeft on a collapsed top-level container is a no-op (transparent root is skipped)', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    await tabIntoTree();
    await userEvent.keyboard('{ArrowLeft}');
    const root = screen.getByRole('treeitem').first();
    await expect.element(root).toHaveAttribute('aria-expanded', 'false');
    // Second ArrowLeft has nowhere to go — transparent parent is skipped, then -1.
    const before = focusedRow();
    await userEvent.keyboard('{ArrowLeft}');
    expect(focusedRow()).toBe(before);
  });

  test('Home jumps to the first open row', async () => {
    await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    await tabIntoTree();
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.keyboard('{Home}');
    expectFocusedRow({ level: 1 });
  });

  test('End jumps to the last open row', async () => {
    await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    await tabIntoTree();
    await userEvent.keyboard('{End}');
    // Last open row in the medium fixture: the last tag value of the last user.
    // It's an array element (no property) at depth 4 → aria-level=5.
    expectFocusedRow({ level: 5, textContains: 'tag-5-b' });
  });

  test('Enter on a container toggles collapse', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    await tabIntoTree();
    await userEvent.keyboard('{ArrowDown}'); // title
    await userEvent.keyboard('{ArrowDown}'); // users
    const usersRow = screen.getByRole('treeitem', { name: /users/ });
    await userEvent.keyboard('{Enter}');
    await expect.element(usersRow).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard('{Enter}');
    await expect.element(usersRow).toHaveAttribute('aria-expanded', 'true');
  });

  test('Space on a container toggles collapse', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    await tabIntoTree();
    await userEvent.keyboard('{ArrowDown}'); // title
    await userEvent.keyboard('{ArrowDown}'); // users
    const usersRow = screen.getByRole('treeitem', { name: /users/ });
    await userEvent.keyboard(' ');
    await expect.element(usersRow).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard(' ');
    await expect.element(usersRow).toHaveAttribute('aria-expanded', 'true');
  });

  test('Enter on a primitive does not change focus and does not throw', async () => {
    await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    await tabIntoTree();
    await userEvent.keyboard('{ArrowDown}'); // title (primitive)
    expectFocusedRow({ property: 'title' });
    await userEvent.keyboard('{Enter}');
    expectFocusedRow({ property: 'title' });
  });

  test('keyboard navigation scrolls the focused row into view', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} height={132} />);
    await waitForStatus('done');
    await tabIntoTree();
    await userEvent.keyboard('{End}');
    const focused = focusedRow();
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLElement;
    const viewportRect = viewport.getBoundingClientRect();
    const focusedRect = focused.getBoundingClientRect();
    expect(focusedRect.top).toBeGreaterThanOrEqual(viewportRect.top - 1);
    expect(focusedRect.bottom).toBeLessThanOrEqual(viewportRect.bottom + 1);
  });
});
