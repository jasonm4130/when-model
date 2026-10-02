import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import DepartureBoard from '../../src/components/DepartureBoard.astro';
import DepartureSign from '../../src/components/DepartureSign.astro';
import Drops from '../../src/components/Drops.astro';
import Feed from '../../src/components/Feed.astro';
import Header from '../../src/components/Header.astro';
import Labs from '../../src/components/Labs.astro';
import Markets from '../../src/components/Markets.astro';
import ScoreDetail from '../../src/components/ScoreDetail.astro';
import Signals from '../../src/components/Signals.astro';
import ServiceStatus from '../../src/components/ServiceStatus.astro';
import SourceHealth from '../../src/components/SourceHealth.astro';
import { LEVEL_NAMES } from '../../src/domain/levels';
import { SERVICE_PHRASES } from '../../src/ui/service-status';
import { assembleDashboard, type DashboardInputs } from '../../src/domain/dashboard';
import type { Drop } from '../../src/domain/drop';
import type { Market } from '../../src/domain/market';
import { STALE_AFTER_MS } from '../../src/ui/panels';

const NOW = Date.parse('2026-09-19T12:00:00Z');

const fable: Drop = {
  id: 'anthropic/claude-fable-5.1',
  name: 'Claude Fable 5.1',
  lab: 'Anthropic',
  labId: 'anthropic',
  createdAt: '2026-09-18T12:00:00Z',
  context: 1_000_000,
  promptPerM: 10,
  completionPerM: 50,
  modality: 'text+image->text',
  url: 'https://openrouter.ai/anthropic/claude-fable-5.1',
  free: false,
};
const release: Market = {
  slug: 'gpt-6',
  title: 'GPT-6 released by...?',
  url: 'https://polymarket.com/event/gpt-6',
  vol24: 65_288,
  volume: 1e6,
  kind: 'release',
  labId: 'openai',
  outcomes: [
    {
      label: 'September 24',
      yes: 0.66,
      endDate: '2026-09-25T00:00:00Z',
      closed: false,
      vol24: 100,
      deadline: '2026-09-25T03:59:59.000Z',
      deadlineKind: 'by',
      bestBid: 0.655,
      bestAsk: 0.665,
      thin: false,
      liquidity: 1000,
    },
  ],
};
const board: Market = {
  slug: 'best',
  title: 'Which company has the best AI model end of September?',
  url: 'https://polymarket.com/event/best',
  vol24: 100_000,
  volume: 2e6,
  kind: 'leaderboard',
  outcomes: [
    { label: 'Google', yes: 0.61, closed: false, vol24: 1 },
    { label: 'Anthropic', yes: 0.3, closed: false, vol24: 1 },
    { label: 'Other', yes: 0.02, closed: false, vol24: 1 },
  ],
};

function dashboard(overrides: Partial<DashboardInputs> = {}) {
  return assembleDashboard(
    {
      markets: { name: 'Polymarket', data: [release, board], ok: true },
      drops: { name: 'OpenRouter', data: [fable], ok: true },
      trending: {
        name: 'HF trending',
        data: [
          {
            id: 'org/open-model',
            url: 'https://huggingface.co/org/open-model',
            likes: 1200,
            downloads: 50_000,
            createdAt: '2026-09-10T00:00:00Z',
            score: 9,
          },
        ],
        ok: true,
      },
      papers: {
        name: 'HF papers',
        data: [
          {
            id: 'p1',
            title: 'Scaling Laws Revisited',
            url: 'https://huggingface.co/papers/p1',
            upvotes: 42,
            publishedAt: '2026-09-18T00:00:00Z',
          },
        ],
        ok: true,
      },
      feeds: [
        {
          name: 'Hacker News',
          data: [
            {
              source: 'hn',
              title: 'Introducing <GPT-6> & friends',
              url: 'https://news.ycombinator.com/item?id=1',
              publishedAt: '2026-09-19T11:00:00Z',
              score: 900,
              alert: true,
            },
          ],
          ok: true,
        },
        { name: 'Anthropic news', data: [], ok: false, error: 'timeout' },
      ],
      ...overrides,
    },
    NOW,
  );
}

describe('components', async () => {
  const container = await AstroContainer.create();
  const d = dashboard();

  it('ServiceStatus posts the level, its name and line, and links to how it adds up', async () => {
    const html = await container.renderToString(ServiceStatus, { props: { c: d.dropcon } });
    const level = d.dropcon.level;
    expect(html).toMatch(new RegExp(`data-num[^>]*>${level}<`));
    expect(html).toContain(LEVEL_NAMES[level]);
    expect(html).toContain(SERVICE_PHRASES[level]);
    expect(html).toContain(d.dropcon.blurb);
    expect(html).toMatch(new RegExp(`class="rung on"[^>]*>${level}<`));
    expect((html.match(/class="rung/g) ?? []).length).toBe(5);
    expect(html).toContain(`lead score <b class="mono"`);
    expect(html).toContain('href="/about#score"');
  });

  it('DepartureSign names the next model departing, its line, the 7-day odds and the boarding window', async () => {
    const html = await container.renderToString(DepartureSign, {
      props: { d, now: Date.parse(d.generatedAt) },
    });
    expect(d.dropcon.headline).toBe('Polymarket prices 66% that GPT-6 ships by Sep 24');
    expect(html).toMatch(/<h1 id="next-title"[^>]*data-flap[^>]*>GPT-6<\/h1>/);
    expect(html).toContain('href="/labs/openai"');
    expect(html).toContain('OpenAI line');
    expect(html).toMatch(/66<small[^>]*>%<\/small>/);
    expect(html).toContain('chance it departs within 7 days');
    // Its only rung is already past even odds: the window is "by" that day.
    expect(html).toContain('by Thu 24 Sep');
    expect(html).toContain('NOT A FORECAST');
    // The odds wear the markets panel's Polymarket pill, which ages to STALE on an open page.
    expect(html).toMatch(
      /data-source-pill data-stale-at="[^"]+" data-stale-text="STALE · POLYMARKET"[^>]*>LIVE · POLYMARKET</,
    );
    const later = await container.renderToString(DepartureSign, {
      props: { d, now: Date.parse(d.generatedAt) + STALE_AFTER_MS },
    });
    expect(later).toContain('>STALE · POLYMARKET<');
  });

  it("DepartureBoard never prints a thin market's odds: that line is 'times unavailable'", async () => {
    const far: Market = {
      ...release,
      slug: 'flash',
      title: 'Next Gemini Flash released by...?',
      labId: 'google',
      outcomes: [
        { ...release.outcomes[0], yes: 0.4, label: 'November 30', deadline: '2026-12-01T04:59:59.000Z' },
      ],
    };
    const both = dashboard({ markets: { name: 'Polymarket', data: [release, far], ok: true } });
    const google = both.labs.find((l) => l.id === 'google')!;
    expect(google.odds?.p7.trusted).toBe(false);
    const html = await container.renderToString(DepartureBoard, { props: { d: both } });
    expect(html).toMatch(/Google DeepMind<\/b>:? ?times unavailable|Google DeepMind:<\/b> times unavailable/);
    expect(html).not.toContain(`>${Math.round(google.odds!.p7.p * 100)}%<`);
    expect(html).toContain('no timetable. Nobody is betting on these lines.');
  });

  it('ScoreDetail shows a provenance that adds up and answers whether it is a forecast', async () => {
    const html = await container.renderToString(ScoreDetail, { props: { d } });
    const pts = [...html.matchAll(/<span class="pts"[^>]*>(\d+)<\/span>/g)].map((m) => Number(m[1]));
    expect(pts).toEqual([...d.dropcon.provenance.map((r) => r.points), d.dropcon.score]);
    expect(pts.slice(0, -1).reduce((a, b) => a + b, 0)).toBe(d.dropcon.score);
    expect(html).toContain('href="https://polymarket.com/event/gpt-6"');
    expect(html).toContain('Is this a forecast?');
    expect(html).toContain('id="score"');
    expect(html).toContain('href="/backtest"');
  });

  it('ServiceStatus calls a floor a signal failure, never a calm level 5, and the sign has no departure', async () => {
    const degraded = dashboard({ markets: { name: 'Polymarket', data: [], ok: false, error: 'down' } });
    const html = await container.renderToString(ServiceStatus, { props: { c: degraded.dropcon } });
    expect(html).toContain('SIGNAL FAILURE');
    expect(html).toContain('Odds offline.');
    // The heading never wears level 5's name (the ladder's hover titles still name every level).
    expect(html.match(/<h2[^>]*>[\s\S]*?<\/h2>/)?.[0]).not.toContain(LEVEL_NAMES[5]);
    expect(html).not.toMatch(/class="rung on"/);
    expect(html).toMatch(/class="rung on held"|class="rung held"/);
    const sign = await container.renderToString(DepartureSign, { props: { d: degraded } });
    expect(sign).toMatch(/data-flap[^>]*>No departures scheduled</);
    expect(sign).toContain('Polymarket is unreachable');
  });

  it('ServiceStatus shows a question mark and no lit rung with no signal at all', async () => {
    const dark = dashboard({
      markets: { name: 'Polymarket', data: [], ok: false, error: 'down' },
      drops: { name: 'OpenRouter', data: [], ok: false, error: 'down' },
    });
    const html = await container.renderToString(ServiceStatus, { props: { c: dark.dropcon } });
    expect(html).toMatch(/data-num[^>]*>\?</);
    expect(html).toContain('NO SIGNAL');
    expect(html).not.toMatch(/class="rung on/);
    expect(html).toContain('aria-label="DROPCON: no signal"');
  });

  it('Signals lists early warnings with their track record and landed launches, neither scored', async () => {
    const html = await container.renderToString(Signals, { props: { d } });
    expect(html).toContain('Early warnings');
    // "Not scored" is said once, in the landed panel's intro; /radar's page intro says none of it moves the level.
    expect(html).toContain('never scored');
    expect(html).toContain(d.earlyWarnings.stealth.track.summary);
    expect(html).toContain('10 of 13 resolved leaks');
    expect(html).toContain(d.earlyWarnings.broadcasts.track.summary);
    expect(html).toContain(d.earlyWarnings.architectures.track.summary);
    expect(html).toContain('Recent arrivals');
    expect(html).toContain('Claude Fable 5.1');
    expect(html).toContain('Hacker News launch stories');
  });

  it('Drops renders integer prices without stripping zeros and marks vision models', async () => {
    const html = await container.renderToString(Drops, { props: { d } });
    expect(html).toContain('$10 / $50');
    expect(html).toContain('Claude Fable 5.1');
    expect(html).toContain('VIS');
    expect(html).toContain('org/open-model');
    expect(html).toContain('Scaling Laws Revisited');
  });

  it('Markets renders release odds and the best-model race with lab colours', async () => {
    const html = await container.renderToString(Markets, { props: { d } });
    expect(html).toContain('GPT-6 released by...?');
    expect(html).toContain('66%');
    expect(html).toContain('$65k');
    expect(html).not.toContain('class="thin"');
  });

  it('Markets shows a thin book as a muted bid-ask range, not odds', async () => {
    const thin: Market = {
      ...release,
      outcomes: [{ ...release.outcomes[0], yes: 0.555, bestBid: 0.27, bestAsk: 0.84, thin: true }],
    };
    const html = await container.renderToString(Markets, {
      props: { d: dashboard({ markets: { name: 'Polymarket', data: [thin, board], ok: true } }) },
    });
    expect(html).toMatch(/<b class="thin"[^>]*>27–84¢<\/b> September 24/);
    expect(html).not.toContain('56%');
    expect(html).toContain('Google');
    expect(html).not.toMatch(/race-name[^>]*>Other</);
  });

  it('Feed escapes untrusted titles and keeps the X watchlist', async () => {
    const html = await container.renderToString(Feed, { props: { d } });
    expect(html).toContain('Introducing &lt;GPT-6&gt; &amp; friends');
    expect(html).not.toContain('<GPT-6>');
    expect(html).toContain('x.com/sama');
    expect(html).toContain('id="feed"');
  });

  it('SourceHealth lists every source, and a failing one with its error', async () => {
    const html = await container.renderToString(SourceHealth, { props: { d } });
    expect(html).toContain('Anthropic news');
    expect(html).toContain('timeout');
    for (const s of d.sources) expect(html).toContain(s.name);
    const up = d.sources.filter((s) => s.ok).length;
    expect(html).toMatch(new RegExp(`>${up}/${d.sources.length}<`));
    expect(html).toContain('Down: ');
  });

  it('Labs lists every line, ranked, with its bullet, status and heat, each linking to its page', async () => {
    const html = await container.renderToString(Labs, { props: { d } });
    for (const lab of d.labs) {
      expect(html).toContain(`${lab.name} line`);
      expect(html).toContain(`href="/labs/${lab.id}"`);
    }
    const order = [...html.matchAll(/class="lrow"[^>]*href="\/labs\/([a-z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(d.labs.map((l) => l.id));
    expect(html).toContain('SHIPPING');
    expect(html).toMatch(/>66%</);
    expect(html).toContain('by 24 Sep');
  });

  it('Labs says "times unavailable" for an extrapolated read and never prints its odds', async () => {
    const far: Market = {
      ...release,
      slug: 'flash',
      title: 'Next Gemini Flash released by...?',
      labId: 'google',
      outcomes: [{ ...release.outcomes[0], label: 'November 30', deadline: '2026-12-01T04:59:59.000Z' }],
    };
    const fd = dashboard({ markets: { name: 'Polymarket', data: [far], ok: true } });
    const html = await container.renderToString(Labs, { props: { d: fd } });
    const google = html.slice(html.indexOf('href="/labs/google"'));
    expect(google.slice(0, google.indexOf('</a>'))).toContain('times unavailable');
    expect(html).not.toMatch(/~\d+%/);
    expect(html).not.toContain(`>${Math.round(fd.labs.find((l) => l.id === 'google')!.odds!.p7.p * 100)}%<`);
  });

  it('Header reports status, names the site for screen readers and keeps an explicit pause control, with no ticker', async () => {
    const html = await container.renderToString(Header, { props: { d, view: { page: 'home' } } });
    expect(html).toMatch(/status-live warn[^>]*>(?:<span[^>]*>Sources <\/span>)?DEGRADED</);
    expect(html).toContain('data-refresh-toggle');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toMatch(/class="sr-only"[^>]*>: frontier model release intelligence, home</);
    // The landed model and the odds are said once each, in the hero and the lab list, not repeated in a crawl.
    expect(html).not.toContain('ticker');
    expect(html).not.toContain('NEW ON OPENROUTER');
  });
});
