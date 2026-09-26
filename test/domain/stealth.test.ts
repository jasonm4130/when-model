import { describe, expect, it } from 'vitest';
import {
  claimsFrontier,
  descriptionExcerpt,
  isFrontierReveal,
  isStealthSlot,
  medianRevealDays,
  OPENROUTER_ROUTERS,
  REVEAL_STATS,
  REVEALS,
  revealDays,
  stealthSlots,
  type StealthCandidate,
} from '../../src/domain/stealth';

const NOW = Date.parse('2026-09-26T00:00:00Z');

/** The live slot on 2026-09-26, as the OpenRouter adapter maps it. */
const spaceBunny: StealthCandidate = {
  id: 'stealth/space-bunny-alpha',
  name: 'Space Bunny Alpha',
  createdAt: '2026-09-23T14:48:04.000Z',
  url: 'https://openrouter.ai/stealth/space-bunny-alpha',
  context: 1_000_000,
  promptPerM: 0,
  completionPerM: 0,
  description:
    'Space Bunny Alpha is an anonymous large model with blazing-fast inference, strong coding capabilities and native multimodal input support. It delivers adjustable reasoning effort, and a 1M-token context window. Space...',
};
const free = { promptPerM: 0, completionPerM: 0 };

describe('isStealthSlot', () => {
  it('takes everything under stealth/', () => {
    expect(isStealthSlot(spaceBunny)).toBe(true);
    expect(
      isStealthSlot({ id: 'stealth/anything', name: 'Anything', promptPerM: 3, completionPerM: 9 }),
    ).toBe(true);
  });

  it('takes free openrouter/* alpha and beta slots', () => {
    expect(isStealthSlot({ id: 'openrouter/horizon-alpha', name: 'Horizon Alpha', ...free })).toBe(true);
    expect(isStealthSlot({ id: 'openrouter/horizon-beta', name: 'Horizon Beta', ...free })).toBe(true);
    expect(isStealthSlot({ id: 'openrouter/cypher-alpha:free', name: 'Cypher Alpha (free)', ...free })).toBe(
      true,
    );
  });

  it('never takes a router, even a free one or one named like a beta', () => {
    for (const slug of OPENROUTER_ROUTERS) {
      expect(isStealthSlot({ id: `openrouter/${slug}`, name: 'Router Beta', ...free })).toBe(false);
    }
    expect(isStealthSlot({ id: 'openrouter/free', name: 'Free Models Router', ...free })).toBe(false);
  });

  it('needs zero pricing and an alpha or beta name under openrouter/', () => {
    expect(
      isStealthSlot({
        id: 'openrouter/new-thing',
        name: 'New Thing Alpha',
        promptPerM: 1,
        completionPerM: 0,
      }),
    ).toBe(false);
    expect(isStealthSlot({ id: 'openrouter/new-thing', name: 'New Thing Alpha' })).toBe(false);
    expect(isStealthSlot({ id: 'openrouter/new-thing', name: 'New Thing', ...free })).toBe(false);
    expect(isStealthSlot({ id: 'openrouter/new-thing', name: 'Alphabet Soup', ...free })).toBe(false);
  });

  it('ignores alpha-named models from ordinary vendors', () => {
    expect(isStealthSlot({ id: 'somelab/thing-alpha', name: 'SomeLab: Thing Alpha', ...free })).toBe(false);
  });
});

describe('claimsFrontier', () => {
  // Stealth-era descriptions that still survive in /endpoints, and the slot's eventual vendor.
  const surviving: Record<string, [string, string]> = {
    union: [
      'Unbiased',
      'Union Alpha is a multimodal model built for research, coding, and agentic workflows, while delivering frontier-level performance across a broad range of general-purpose tasks.',
    ],
    hunter: [
      'Xiaomi',
      'Hunter Alpha is a 1 Trillion parameter + 1M token context frontier intelligence model built for agentic use.',
    ],
    healer: [
      'Xiaomi',
      'Healer Alpha is a frontier omni-modal model with vision, hearing, reasoning, and action capabilities.',
    ],
    sonomaSky: [
      'xAI',
      'This is a cloaked model provided to the community to gather feedback. A maximally intelligent general-purpose frontier model with a 2 million token context window.',
    ],
    sonomaDusk: [
      'xAI',
      'This is a cloaked model provided to the community to gather feedback. A fast and intelligent general-purpose frontier model with a 2 million token context window.',
    ],
    horizonBeta: [
      'OpenAI',
      'This is a cloaked model provided to the community to gather feedback. This is an improved version of [Horizon Alpha](/openrouter/horizon-alpha)',
    ],
    quasar: [
      'OpenAI',
      'This is a cloaked model provided to the community to gather feedback. It’s a powerful, all-purpose model supporting long-context tasks, including code generation.',
    ],
    pony: [
      'Z.ai',
      'Pony is a cutting-edge foundation model with strong performance in coding, agentic workflows, reasoning, and roleplay.',
    ],
    ox: [
      'Z.ai',
      'Ox Alpha is a reasoning model designed for coding, sustained agentic work, and production workloads.',
    ],
    owl: ['Meituan', 'Owl Alpha is a high-performance foundation model designed for agentic workloads.'],
  };

  it('matches the explicit claims only, and says little about who is behind the slot', () => {
    const claimed = Object.entries(surviving).filter(([, [, text]]) => claimsFrontier(text));
    expect(claimed.map(([slot]) => slot)).toEqual(['union', 'hunter', 'sonomaSky', 'sonomaDusk']);
    expect(new Set(claimed.map(([, [vendor]]) => vendor))).toEqual(new Set(['Unbiased', 'Xiaomi', 'xAI']));
  });

  it('is false for the live slot and for no description', () => {
    expect(claimsFrontier(spaceBunny.description)).toBe(false);
    expect(claimsFrontier(undefined)).toBe(false);
  });
});

describe('descriptionExcerpt', () => {
  it('keeps a short first sentence', () => {
    expect(descriptionExcerpt(spaceBunny.description)).toBe(
      'Space Bunny Alpha is an anonymous large model with blazing-fast inference, strong coding capabilities and native multimodal input support.',
    );
  });

  it('cuts a long run-on at a word boundary', () => {
    const long = `${'word '.repeat(40)}end`;
    const cut = descriptionExcerpt(long)!;
    expect(cut.endsWith('word…')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(161);
    expect(descriptionExcerpt('x'.repeat(200))).toBe(`${'x'.repeat(160)}…`);
  });

  it('flattens markdown links and whitespace, and keeps short unpunctuated text', () => {
    expect(descriptionExcerpt('An improved   version of [Horizon Alpha](/openrouter/horizon-alpha)')).toBe(
      'An improved version of Horizon Alpha',
    );
  });

  it('returns undefined for nothing', () => {
    expect(descriptionExcerpt(undefined)).toBeUndefined();
    expect(descriptionExcerpt('   ')).toBeUndefined();
  });
});

describe('stealthSlots', () => {
  const ordinary: StealthCandidate = {
    id: 'openai/gpt-6-sol',
    name: 'GPT-6 Sol',
    createdAt: '2026-09-22T18:12:55Z',
  };
  const older: StealthCandidate = {
    id: 'openrouter/owl-alpha',
    name: 'Owl Alpha',
    createdAt: '2026-04-28T17:49:49Z',
    ...free,
  };

  it('keeps stealth slots only, newest first, with their age and excerpt', () => {
    const slots = stealthSlots([older, ordinary, spaceBunny], NOW);
    expect(slots.map((s) => s.id)).toEqual(['stealth/space-bunny-alpha', 'openrouter/owl-alpha']);
    expect(slots[0]).toMatchObject({
      name: 'Space Bunny Alpha',
      url: 'https://openrouter.ai/stealth/space-bunny-alpha',
      createdAt: '2026-09-23T14:48:04.000Z',
      contextLength: 1_000_000,
      claimsFrontier: false,
    });
    expect(slots[0].daysInStealth).toBeCloseTo(2.383, 3);
    expect(slots[0].descriptionExcerpt).toMatch(/^Space Bunny Alpha is an anonymous large model/);
    expect(slots[1]).toMatchObject({ contextLength: undefined, descriptionExcerpt: undefined });
  });

  it('prefers an earlier first-seen time over a rewritten created', () => {
    const firstSeen = new Map([['stealth/space-bunny-alpha', '2026-09-22T10:58:00Z']]);
    const [slot] = stealthSlots([spaceBunny], NOW, firstSeen);
    expect(slot.createdAt).toBe('2026-09-22T10:58:00.000Z');
    expect(slot.daysInStealth).toBeCloseTo(3.543, 3);

    const later = new Map([['stealth/space-bunny-alpha', '2026-09-24T00:00:00Z']]);
    expect(stealthSlots([spaceBunny], NOW, later)[0].createdAt).toBe('2026-09-23T14:48:04.000Z');
    const junk = new Map([['stealth/space-bunny-alpha', 'not a date']]);
    expect(stealthSlots([spaceBunny], NOW, junk)[0].createdAt).toBe('2026-09-23T14:48:04.000Z');
  });

  it('never reports a negative age and skips undated slots', () => {
    const future = { ...spaceBunny, createdAt: '2026-09-27T00:00:00Z' };
    expect(stealthSlots([future], NOW)[0].daysInStealth).toBe(0);
    expect(stealthSlots([{ ...spaceBunny, createdAt: 'soon' }], NOW)).toEqual([]);
  });
});

describe('REVEALS', () => {
  it('holds the twelve resolved events, eleven of them verified', () => {
    expect(REVEALS).toHaveLength(12);
    expect(REVEALS.filter((r) => !r.verified).map((r) => r.slot)).toEqual(['Owl Alpha']);
    expect(REVEALS.find((r) => r.slot === 'Owl Alpha')?.attribution).toBe('third-party');
  });

  it('records a checkable first-party source for every verified row', () => {
    for (const r of REVEALS.filter((row) => row.verified)) {
      expect(r.attribution).not.toBe('third-party');
      expect(r.source).toMatch(/^https:\/\/openrouter\.ai\//);
    }
  });

  it('keeps ids and timestamps in OpenRouter shape, with the reveal after the slot', () => {
    for (const r of REVEALS) {
      expect(r.slotIds.every((id) => /^(openrouter|stealth)\/[a-z0-9-]+$/.test(id))).toBe(true);
      expect(r.officialIds.every((id) => /^[a-z0-9-]+\/[a-z0-9.-]+$/.test(id))).toBe(true);
      expect(r.stealthCreatedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
      expect(r.officialCreatedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
      expect(revealDays(r)).toBeGreaterThan(1);
    }
  });

  it("labels Pareto as Unbiased's model, not OpenRouter's router", () => {
    const union = REVEALS.find((r) => r.slot === 'Union Alpha')!;
    expect(union).toMatchObject({ vendor: 'Unbiased', officialIds: ['unbiased/pareto'] });
    expect(isFrontierReveal(union)).toBe(false);
    expect(revealDays(union)).toBeCloseTo(1.35, 2);
  });

  it('computes the medians from the table', () => {
    expect(REVEAL_STATS.all.n).toBe(11);
    expect(REVEAL_STATS.all.medianDays).toBeCloseTo(6.98, 2);
    expect(REVEAL_STATS.frontier.n).toBe(5);
    expect(REVEAL_STATS.frontier.medianDays).toBeCloseTo(7.8, 2);
    expect(REVEALS.filter(isFrontierReveal).map((r) => r.revealedAs)).toEqual([
      'Grok 4.1 Fast',
      'GPT-5.1',
      'GPT-5',
      'GPT-4.1',
      'Grok 4 Fast',
    ]);
  });

  it('takes the middle pair for an even count and NaN for none', () => {
    expect(medianRevealDays(REVEALS)).toBeCloseTo((revealDays(REVEALS[5]) + revealDays(REVEALS[6])) / 2, 6);
    expect(medianRevealDays([])).toBeNaN();
  });
});
