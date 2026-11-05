/**
 * Name → entity resolution with exact-match semantics.
 *
 * Collibra's name filters are "contains"/ANYWHERE matches, so a search for
 * "Steward" can return "Business Steward" first. Silently taking `results[0]`
 * then assigns or edits the wrong thing. These helpers only accept a single
 * exact (case-insensitive) match and otherwise return a descriptive error with
 * the candidates, so the caller can ask for a precise name or UUID.
 */

export type ExactResolution<T> =
  | { ok: true; match: T }
  | { ok: false; reason: 'not_found' | 'ambiguous'; message: string; candidates: string[] };

/**
 * Pick the single result whose any of `keys(item)` equals `query`
 * (case-insensitive, trimmed).
 */
export function pickExact<T>(
  results: T[],
  query: string,
  keys: (item: T) => Array<string | null | undefined>,
  label: (item: T) => string,
  kind: string,
): ExactResolution<T> {
  const q = query.trim().toLowerCase();
  const exact = results.filter((item) => keys(item).some((k) => typeof k === 'string' && k.trim().toLowerCase() === q));
  if (exact.length === 1) return { ok: true, match: exact[0] };
  const pool = exact.length > 1 ? exact : results;
  const candidates = pool.slice(0, 10).map(label);
  if (exact.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous',
      message: `${kind} "${query}" is ambiguous (${exact.length} exact matches: ${candidates.join(', ')}). Use the UUID instead.`,
      candidates,
    };
  }
  return {
    ok: false,
    reason: 'not_found',
    message:
      `No ${kind} named exactly "${query}".` +
      (candidates.length ? ` Similar: ${candidates.join(', ')}. Use the exact name or the UUID.` : ''),
    candidates,
  };
}
