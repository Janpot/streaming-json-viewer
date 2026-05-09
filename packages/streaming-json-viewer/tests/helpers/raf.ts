/**
 * Wait for `frames` requestAnimationFrame ticks. Two frames is the typical
 * "let React's commit, then the post-commit effect, finish" budget after a
 * scroll event or programmatic state change.
 */
export async function settle(frames = 2) {
  for (let i = 0; i < frames; i++) {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
}
