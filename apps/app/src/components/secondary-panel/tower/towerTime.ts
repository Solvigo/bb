/**
 * How long ago something happened, in the Tower's own shorthand.
 *
 * Returns null for a missing, unparseable or future instant, so a caller can
 * tell "no time recorded" apart from "just now" instead of printing a zero.
 */
export function ageSince(
  at?: string | null,
): { label: string; ms: number } | null {
  if (!at) return null;
  const ms = Date.now() - new Date(at).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = Math.floor(ms / 1000);
  if (s < 60) return { label: `${s}s`, ms };
  const m = Math.floor(s / 60);
  if (m < 60) return { label: `${m}m`, ms };
  const h = Math.floor(m / 60);
  if (h < 24) return { label: `${h}h ${m % 60}m`, ms };
  return { label: `${Math.floor(h / 24)}d ${h % 24}h`, ms };
}
