/**
 * Today v2 — shared display-formatting helpers.
 *
 * Kept tiny and dependency-free so the same grammar rules are reused
 * everywhere a "last checked / refreshed" line is rendered, instead of
 * being re-derived (and re-broken) per component.
 */

/**
 * Builds a grammatical "ago" phrase, special-casing the `'just now'`
 * label so the page never prints the broken "checked just now ago".
 *
 * @param verb - The leading verb ('checked' or 'Refreshed').
 * @param label - A relative-time label (e.g. '11m', '2h', 'just now').
 * @returns `${verb} just now` when the label is 'just now', otherwise
 *   `${verb} ${label} ago`.
 *
 * @example
 * formatAgoPhrase('checked', 'just now'); // 'checked just now'
 * formatAgoPhrase('checked', '11m');      // 'checked 11m ago'
 */
export function formatAgoPhrase(verb: 'checked' | 'Refreshed', label: string): string {
  if (label === 'just now') return `${verb} just now`;
  return `${verb} ${label} ago`;
}
