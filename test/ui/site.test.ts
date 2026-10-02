import { describe, expect, it } from 'vitest';
import { LABS } from '../../src/domain/lab';
import { LEGACY_HASHES, NAV, labPath, legacyHashTarget, navKey, pageMeta } from '../../src/ui/site';

describe('site map', () => {
  it('has one tab per page, in reading order, each with its own path', () => {
    expect(NAV.map((n) => n.href)).toEqual(['/', '/labs', '/markets', '/radar', '/about', '/backtest']);
    expect(new Set(NAV.map((n) => n.key)).size).toBe(NAV.length);
  });

  it('files a lab page under Labs and the 404 under no tab', () => {
    expect(navKey({ page: 'home' })).toBe('home');
    expect(navKey({ page: 'lab', lab: 'anthropic' })).toBe('labs');
    expect(navKey({ page: 'backtest' })).toBe('backtest');
    expect(navKey({ page: 'not-found' })).toBeUndefined();
    expect(labPath('deepseek')).toBe('/labs/deepseek');
  });

  it('gives every page its own title and description, and a lab page asks when the lab will ship', () => {
    const views = [
      { page: 'labs' },
      { page: 'markets' },
      { page: 'radar' },
      { page: 'about' },
      ...LABS.map((l) => ({ page: 'lab' as const, lab: l.id })),
    ] as const;
    const metas = views.map((v) => pageMeta(v));
    expect(new Set(metas.map((m) => m.title)).size).toBe(metas.length);
    for (const m of metas) {
      expect(m.title).toMatch(/ — whenmodel$/);
      expect(m.description.length).toBeGreaterThan(60);
    }
    expect(pageMeta({ page: 'lab', lab: 'anthropic' }).title).toBe('When will Anthropic ship? — whenmodel');
  });
});

describe('legacyHashTarget', () => {
  it("sends each registry lab's old card anchor to its page", () => {
    for (const lab of LABS) expect(legacyHashTarget(`#lab-${lab.id}`)).toBe(`/labs/${lab.id}`);
    expect(legacyHashTarget('lab-openai')).toBe('/labs/openai');
    expect(legacyHashTarget('#LAB-OpenAI')).toBe('/labs/openai');
  });

  it('sends the old section anchors to the page that holds them now', () => {
    expect(legacyHashTarget('#markets')).toBe('/markets');
    expect(legacyHashTarget('#labs')).toBe('/labs');
    expect(legacyHashTarget('#ew-leaks')).toBe('/radar#ew-leaks');
    expect(legacyHashTarget('#feed')).toBe('/radar#feed');
    expect(legacyHashTarget('#faq')).toBe('/about#faq-title');
    expect(legacyHashTarget('#dc-adds')).toBe('/about#score');
    // Every target is a path on this site, never an open redirect.
    for (const target of Object.values(LEGACY_HASHES)) expect(target).toMatch(/^\/[a-z]/);
  });

  it('leaves anchors that still mean something on / (or never did) alone', () => {
    for (const hash of [
      '',
      '#',
      '#main',
      '#dc-title',
      '#lab-nope',
      '#lab-',
      '#constructor',
      '#__proto__',
      '#toString',
    ])
      expect(legacyHashTarget(hash)).toBeUndefined();
    // A malformed escape is not one of ours.
    expect(legacyHashTarget('#%E0%A4%A')).toBeUndefined();
    expect(legacyHashTarget('#%6Darkets')).toBe('/markets');
  });
});
