import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';
import { TestViewer } from './helpers/TestViewer';
import { makeMediumFixture } from './helpers/fixtures';
import { focusedRow } from './helpers/focus';
import { settle } from './helpers/raf';
import { waitForStatus } from './helpers/wait';

function isOutlineVisible(el: Element): boolean {
  const cs = getComputedStyle(el);
  return cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
}

describe('mouse and keyboard', () => {
  test('click row then ArrowDown moves focus to the next row', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    const titleRow = screen.getByRole('treeitem', { name: /title/ });
    await userEvent.click(titleRow);
    expect(focusedRow().textContent).toContain('title');
    await userEvent.keyboard('{ArrowDown}');
    expect(focusedRow().textContent).not.toContain('title');
  });

  test('click selects a row but does NOT show focus-visible outline', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    const titleRow = screen.getByRole('treeitem', { name: /title/ });
    await userEvent.click(titleRow);
    const el = focusedRow();
    expect(el.matches(':focus-visible')).toBe(false);
    expect(isOutlineVisible(el)).toBe(false);
    // data-focused IS set so the user still gets visual feedback.
    expect(el.hasAttribute('data-focused')).toBe(true);
  });

  test('tabbing into the tree DOES show focus-visible outline', async () => {
    await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    await userEvent.tab(); // leading button
    await userEvent.tab(); // first treeitem
    const el = focusedRow();
    expect(el.matches(':focus-visible')).toBe(true);
    expect(isOutlineVisible(el)).toBe(true);
  });

  test('arrow-key navigation preserves focus-visible across rows', async () => {
    await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}');
    const el = focusedRow();
    expect(el.matches(':focus-visible')).toBe(true);
    expect(isOutlineVisible(el)).toBe(true);
  });

  test('click after keyboard nav drops focus-visible', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} />);
    await waitForStatus('done');
    await userEvent.tab();
    await userEvent.tab();
    expect(focusedRow().matches(':focus-visible')).toBe(true);
    const titleRow = screen.getByRole('treeitem', { name: /title/ });
    await userEvent.click(titleRow);
    const el = focusedRow();
    expect(el.matches(':focus-visible')).toBe(false);
    expect(isOutlineVisible(el)).toBe(false);
  });

  test('data-focused only applies while DOM focus is inside the viewer', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} withTrailingButton />);
    await waitForStatus('done');
    // Enter via Tab so we land on the first row in a clean state (avoids the
    // click-handler interaction with shouldFocusDomRef that can refocus the
    // row immediately after blur).
    await userEvent.tab(); // leading button
    await userEvent.tab(); // first treeitem
    const focused = focusedRow();
    expect(focused.hasAttribute('data-focused')).toBe(true);

    // Move focus to the trailing button outside the viewer.
    const trailing = screen.getByTestId('trailing-button').element() as HTMLElement;
    trailing.focus();
    await expect.element(focused).not.toHaveAttribute('data-focused');
    // The row still owns the tab stop so keyboard users can re-enter the tree.
    expect(focused.getAttribute('tabindex')).toBe('0');

    // Tabbing back from the leading button restores data-focused on the same row.
    const leading = screen.getByTestId('leading-button').element() as HTMLElement;
    leading.focus();
    await userEvent.tab();
    await expect.element(focused).toHaveAttribute('data-focused');
  });

  test('Tab after click + ArrowDown leaves the viewer', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} withTrailingButton />);
    await waitForStatus('done');
    const titleRow = screen.getByRole('treeitem', { name: /title/ });
    await userEvent.click(titleRow);
    await userEvent.keyboard('{ArrowDown}');
    // Focus is now on the row after `title`; one Tab must take us out entirely.
    await userEvent.tab();
    await expect.element(screen.getByTestId('trailing-button')).toHaveFocus();
  });

  test('scrolling does not remount visible rows (no focus flicker)', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} height={132} />);
    await waitForStatus('done');

    // Land keyboard focus on a primitive several levels deep so scrolling
    // crosses sticky-header boundaries while the row stays in view.
    await userEvent.tab();
    await userEvent.tab();
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}');

    const before = document.activeElement as HTMLElement;
    expect(before.textContent).toContain('id');
    expect(before.matches(':focus-visible')).toBe(true);

    const viewport = screen.getByTestId('tv-viewport').element() as HTMLDivElement;
    await userEvent.wheel(viewport, { delta: { y: 22 } });
    await settle();

    // Same DOM node, same focus, same :focus-visible — no remount.
    expect(before.isConnected).toBe(true);
    expect(document.activeElement).toBe(before);
    expect(before.matches(':focus-visible')).toBe(true);
  });

  test('focus-visible survives scrolling the focused row offscreen and back', async () => {
    const screen = await render(<TestViewer value={makeMediumFixture()} height={132} />);
    await waitForStatus('done');
    await userEvent.tab(); // leading button
    await userEvent.tab(); // root `{` row
    // Move focus down to `title`, a primitive that can never become sticky.
    // The root above it stays sticky-pinned, so scrolling will only displace
    // `title` itself.
    await userEvent.keyboard('{ArrowDown}');
    const titleRow = screen.getByRole('treeitem', { name: /title/ });
    await expect.element(titleRow).toHaveFocus();
    expect((titleRow.element() as HTMLElement).matches(':focus-visible')).toBe(true);

    // Scroll past `title` so it unmounts, then back to the top so it remounts.
    const viewport = screen.getByTestId('tv-viewport').element() as HTMLDivElement;
    viewport.scrollTop = viewport.scrollHeight;
    viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
    await settle();
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new Event('scroll', { bubbles: true }));
    await settle();

    const titleAgain = screen.getByRole('treeitem', { name: /title/ });
    await expect.element(titleAgain).toHaveFocus();
    expect((titleAgain.element() as HTMLElement).matches(':focus-visible')).toBe(true);
  });
});
