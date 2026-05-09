/**
 * Approximate accessible-text computation: walk the subtree, skip nodes hidden
 * from the AT (`aria-hidden="true"`), and collect text content. Sufficient for
 * asserting that brackets/colons/ellipsis don't end up in the accessible name.
 */
export function accessibleText(el: Element): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.nodeValue ?? '');
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.getAttribute('aria-hidden') === 'true') return;
    for (const child of Array.from(node.childNodes)) walk(child);
  };
  walk(el);
  return parts.join('').replace(/\s+/g, ' ').trim();
}
