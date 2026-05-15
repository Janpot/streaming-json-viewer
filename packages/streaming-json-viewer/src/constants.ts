// Browsers cap the maximum height of a single element. Firefox is the strictest
// (~17M px). We stay well below that and decouple the document offset from the
// native scrollTop above this threshold so the viewer can render any number of
// rows. See https://rednegra.net/blog/20260212-virtual-scroll/#technique-4-pixel-precise-scroll
//
// Lives in its own module so tests can `vi.mock` it to lower the cap and
// exercise the pixel-cap code path with small fixtures.
export const SAFE_MAX_SPACER_HEIGHT = 8_000_000;
