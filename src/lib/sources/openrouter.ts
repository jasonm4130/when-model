import { cachedJson, toIso } from '../fetch';
import { labForOpenRouterId } from '../labs';

interface OrModel {
  id: string;
  name: string;
  created: number;
  context_length?: number;
  description?: string;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { modality?: string; input_modalities?: string[] };
}

export interface Drop {
  id: string;
  name: string;
  lab?: string;
  labId?: string;
  createdAt: string;
  context?: number;
  promptPerM?: number;
  completionPerM?: number;
  modality?: string;
  url: string;
  free: boolean;
}

export async function fetchDrops(): Promise<Drop[]> {
  const { data } = await cachedJson<{ data: OrModel[] }>('https://openrouter.ai/api/v1/models', 600);
  return (data ?? [])
    .filter(
      (m) =>
        typeof m.id === 'string' &&
        typeof m.name === 'string' &&
        Number.isFinite(m.created) &&
        !m.id.startsWith('~') &&
        !m.id.endsWith(':batch') &&
        !m.id.startsWith('openrouter/'),
    )
    .sort((a, b) => b.created - a.created)
    .map((m) => {
      const lab = labForOpenRouterId(m.id);
      const p = parseFloat(m.pricing?.prompt ?? 'NaN') * 1e6;
      const c = parseFloat(m.pricing?.completion ?? 'NaN') * 1e6;
      return {
        id: m.id,
        name: m.name.replace(/^[^:]+:\s*/, ''),
        lab: lab?.name ?? m.name.split(':')[0],
        labId: lab?.id,
        createdAt: toIso(m.created * 1000) ?? new Date(0).toISOString(),
        context: m.context_length,
        promptPerM: Number.isFinite(p) ? p : undefined,
        completionPerM: Number.isFinite(c) ? c : undefined,
        modality: m.architecture?.modality,
        url: `https://openrouter.ai/${m.id.split('/').map(encodeURIComponent).join('/')}`,
        free: m.id.endsWith(':free') || p === 0,
      };
    });
}

/** Drops per month for the last N months, oldest first. */
export function monthlyHistogram(drops: Drop[], months = 12, now = new Date()): number[] {
  const buckets = Array.from({ length: months }, () => 0);
  const y0 = now.getUTCFullYear(),
    m0 = now.getUTCMonth();
  for (const d of drops) {
    const t = new Date(d.createdAt);
    const idx = months - 1 - ((y0 - t.getUTCFullYear()) * 12 + (m0 - t.getUTCMonth()));
    if (idx >= 0 && idx < months) buckets[idx]++;
  }
  return buckets;
}
