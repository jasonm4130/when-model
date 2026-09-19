/** Presentation-only formatting. Pure; safe to unit test. */

export function ago(iso: string, now: number): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  const days = Math.floor(seconds / 86400);
  return days === 1 ? '1d ago' : `${days}d ago`;
}

export function pct(p?: number): string {
  return p === undefined ? '—' : `${Math.round(p * 100)}%`;
}

export function usd(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${Math.round(n)}`;
}

export function num(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}

/** Context window: "262k", "1M", "1.0M" when not a round million. */
export function ctx(tokens?: number): string {
  if (!tokens) return '—';
  if (tokens >= 1e6) return `${(tokens / 1e6).toFixed(tokens % 1e6 ? 1 : 0)}M`;
  return `${Math.round(tokens / 1000)}k`;
}

export function shortDate(iso: string): string {
  return new Date(iso)
    .toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })
    .toUpperCase();
}

/** Price per million tokens: 3 decimals under $0.10, 2 under $10, whole dollars above. Never strips integer zeros. */
export function perMillion(n: number): string {
  const fixed = n < 0.1 ? n.toFixed(3) : n < 10 ? n.toFixed(2) : n.toFixed(0);
  return `$${fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed}`;
}

export function daysLabel(days: number | undefined): string {
  if (days === undefined) return '—';
  return days === 0 ? 'TODAY' : `${days}d`;
}

/** Twelve single-letter month initials ending with the current month, for histogram axes. */
export function monthInitials(now: Date, months = 12): string[] {
  const out: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(t.toLocaleString('en', { month: 'short', timeZone: 'UTC' })[0]);
  }
  return out;
}
