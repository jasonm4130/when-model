import { describe, expect, it } from 'vitest';
import { assembleDashboard, type DashboardInputs } from '../../src/domain/dashboard';
import type { Drop } from '../../src/domain/drop';
import { dashboardFingerprint } from '../../src/ui/fingerprint';

const NOW = Date.parse('2026-09-19T12:00:00Z');

const drop: Drop = {
  id: 'anthropic/claude-fable-5.1',
  name: 'Claude Fable 5.1',
  lab: 'Anthropic',
  labId: 'anthropic',
  createdAt: '2026-09-18T12:00:00Z',
  context: 1_000_000,
  promptPerM: 10,
  completionPerM: 50,
  modality: 'text->text',
  url: 'https://openrouter.ai/anthropic/claude-fable-5.1',
  free: false,
};

const inputs: DashboardInputs = {
  markets: { name: 'Polymarket', data: [], ok: false, error: 'timeout' },
  drops: { name: 'OpenRouter', data: [drop], ok: true },
  trending: { name: 'HF trending', data: [], ok: true },
  papers: { name: 'HF papers', data: [], ok: true },
  feeds: [{ name: 'Hacker News', data: [], ok: true }],
};

describe('dashboardFingerprint', () => {
  it('matches between the rendered object and the JSON the API serves for it', () => {
    // The page fingerprints the assembled object (which can hold undefined fields); the browser
    // fingerprints the parsed /api/dashboard.json body. They must agree or every poll reads as new data.
    const rendered = assembleDashboard(inputs, NOW);
    const served = JSON.parse(JSON.stringify(rendered)) as object;
    expect(dashboardFingerprint(served)).toBe(dashboardFingerprint(rendered));
  });

  it('ignores generatedAt, so a rebuild with the same content is not new data', () => {
    const first = assembleDashboard(inputs, NOW);
    const rebuilt = { ...first, generatedAt: '2026-09-19T12:02:00.000Z' };
    expect(rebuilt.generatedAt).not.toBe(first.generatedAt);
    expect(dashboardFingerprint(rebuilt)).toBe(dashboardFingerprint(first));
  });

  it('changes when anything the reader could see changes', () => {
    const before = assembleDashboard(inputs, NOW);
    const after = assembleDashboard(
      { ...inputs, drops: { name: 'OpenRouter', data: [{ ...drop, promptPerM: 8 }], ok: true } },
      NOW,
    );
    expect(dashboardFingerprint(after)).not.toBe(dashboardFingerprint(before));
  });

  it('is a short, fixed-width hex digest rather than the whole payload', () => {
    expect(dashboardFingerprint(assembleDashboard(inputs, NOW))).toMatch(/^[0-9a-f]{8}$/);
    expect(dashboardFingerprint({})).toMatch(/^[0-9a-f]{8}$/);
  });
});
