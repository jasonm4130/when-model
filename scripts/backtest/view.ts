/**
 * Display helpers shared by the /backtest components. Pure; the page renders them server-side.
 */

/** "2026-09-22 16:27Z" from an ISO timestamp; "—" when missing. */
export function utcMinute(iso: string | null | undefined): string {
  return iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}Z` : '—';
}

/**
 * A signed duration for tables: "+31.0h", "−0.5h", "+10.6d". Hours up to two days, days beyond.
 * Uses a real minus sign so the column reads cleanly in the pixel font.
 */
export function signedHours(h: number | null | undefined): string {
  if (h === null || h === undefined) return '—';
  const sign = h > 0 ? '+' : h < 0 ? '−' : '';
  const abs = Math.abs(h);
  return abs >= 48 ? `${sign}${(abs / 24).toFixed(1)}d` : `${sign}${abs.toFixed(1)}h`;
}

/** "0.772" → "77%"; "—" when missing. */
export function pct(p: number | null | undefined, digits = 0): string {
  return p === null || p === undefined ? '—' : `${(p * 100).toFixed(digits)}%`;
}

/**
 * Symmetric log scale for the lead-time axis: linear within `c` hours of the announcement,
 * logarithmic beyond, so a 30-minute lead and a 10-day lead both stay readable.
 */
export function symlog(h: number, c = 3): number {
  return Math.sign(h) * Math.log10(1 + Math.abs(h) / c);
}

/** Maps [d0, d1] to [r0, r1] through `symlog`, clamping to the domain. */
export function symlogScale(d0: number, d1: number, r0: number, r1: number, c = 3): (h: number) => number {
  const s0 = symlog(d0, c);
  const s1 = symlog(d1, c);
  return (h) => {
    const clamped = Math.min(Math.max(h, d0), d1);
    return r0 + ((symlog(clamped, c) - s0) / (s1 - s0)) * (r1 - r0);
  };
}
