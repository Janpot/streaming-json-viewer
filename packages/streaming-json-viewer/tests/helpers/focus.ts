import { expect } from 'vitest';
import { page, userEvent } from 'vitest/browser';

/**
 * Tab repeatedly until `target` becomes the active element. Throws if it isn't
 * reached within `max` tabs. Use this instead of hard-coding the tab count
 * needed to reach a particular element — that count depends on whatever else
 * is in the DOM and silently rots when the surrounding markup changes.
 */
export async function tabIntoElement(target: HTMLElement, max = 50) {
  if (document.activeElement === target) return;
  for (let i = 0; i < max; i++) {
    await userEvent.tab();
    if (document.activeElement === target) return;
  }
  const active = document.activeElement;
  const activeDesc =
    active instanceof HTMLElement
      ? `${active.tagName}${active.id ? `#${active.id}` : ''}`
      : (active?.nodeName ?? 'null');
  throw new Error(`tabIntoElement: target not reached after ${max} tabs (activeElement=${activeDesc})`);
}

/**
 * Tab into the tree's roving tab stop — the single treeitem that holds
 * `tabindex="0"`. DOM order can put a sticky-wrapper open after non-tabbable
 * absolute rows, so the first `[role=treeitem]` is not always the tab target.
 */
export async function tabIntoTree(): Promise<HTMLElement> {
  const tree = page.getByRole('tree').element();
  const target = tree.querySelector('[role="treeitem"][tabindex="0"]') as HTMLElement | null;
  if (!target) throw new Error('tabIntoTree: no treeitem with tabindex=0 found');
  await tabIntoElement(target);
  return target;
}

/**
 * Returns the currently-focused row, asserting it is a `role=treeitem`. Throws
 * a descriptive error if focus is elsewhere — gives loud failures instead of
 * silent reads against `null`.
 */
export function focusedRow(): HTMLElement {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el.getAttribute('role') !== 'treeitem') {
    throw new Error(
      `expected focused element to be role=treeitem, got ${el?.tagName ?? 'null'} (role=${el?.getAttribute('role') ?? 'none'})`,
    );
  }
  return el;
}

export interface RowExpectation {
  property?: string;
  level?: number;
  posinset?: number;
  setsize?: number;
  textContains?: string;
}

/**
 * Asserts that the currently-focused treeitem matches every field of `opts`.
 * `property` matches the visible `data-token="property"` text, with the
 * surrounding quotes stripped.
 */
export function expectFocusedRow(opts: RowExpectation) {
  const el = focusedRow();
  if (opts.property !== undefined) {
    const propEl = el.querySelector('[data-token="property"]');
    const raw = propEl?.textContent ?? '';
    expect(raw.replace(/^"|"$/g, '')).toBe(opts.property);
  }
  if (opts.level !== undefined) expect(el.getAttribute('aria-level')).toBe(String(opts.level));
  if (opts.posinset !== undefined)
    expect(el.getAttribute('aria-posinset')).toBe(String(opts.posinset));
  if (opts.setsize !== undefined)
    expect(el.getAttribute('aria-setsize')).toBe(String(opts.setsize));
  if (opts.textContains !== undefined) expect(el.textContent).toContain(opts.textContains);
}
