import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import type { Backtest, CrossingRow } from '../../scripts/backtest/build';
import BacktestAlarms from '../../src/components/BacktestAlarms.astro';
import BacktestArchitecture from '../../src/components/BacktestArchitecture.astro';
import BacktestBroadcasts from '../../src/components/BacktestBroadcasts.astro';
import BacktestLimits from '../../src/components/BacktestLimits.astro';
import BacktestNegatives from '../../src/components/BacktestNegatives.astro';
import BacktestReleases from '../../src/components/BacktestReleases.astro';
import BacktestReliability from '../../src/components/BacktestReliability.astro';
import BacktestReproduce from '../../src/components/BacktestReproduce.astro';
import BacktestScores from '../../src/components/BacktestScores.astro';
import BacktestSplits from '../../src/components/BacktestSplits.astro';
import BacktestTraps from '../../src/components/BacktestTraps.astro';
import BacktestWaterfall from '../../src/components/BacktestWaterfall.astro';
import Footer from '../../src/components/Footer.astro';
import History from '../../src/components/History.astro';
import BacktestPage from '../../src/pages/backtest.astro';
import releaseJson from '../../data/backtest/release-events.json';
import marketsJson from '../../data/backtest/markets.json';
import broadcastsJson from '../../data/backtest/broadcasts.json';
import architectureJson from '../../data/backtest/architecture.json';
import negativesJson from '../../data/backtest/negative-results.json';
import trapsJson from '../../data/backtest/timestamp-traps.json';

const events = releaseJson as unknown as Backtest['release-events'];
const markets = marketsJson as unknown as Backtest['markets'];
const broadcasts = broadcastsJson as unknown as Backtest['broadcasts'];
const architecture = architectureJson as unknown as Backtest['architecture'];
const negatives = negativesJson as unknown as Backtest['negative-results'];
const traps = trapsJson as unknown as Backtest['timestamp-traps'];

/** Text content with tags stripped and entities for quotes decoded, for copy assertions. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

describe('backtest components', async () => {
  const container = await AstroContainer.create();

  it('waterfall is an accessible SVG with a summary and every launch, in both layouts', async () => {
    const html = await container.renderToString(BacktestWaterfall, {
      props: { releases: events.releases, crossings: markets.crossings },
    });
    const svgs = html.match(/<svg[^>]*role="img"[^>]*>/g) ?? [];
    expect(svgs).toHaveLength(2);
    for (const svg of svgs) expect(svg).toMatch(/aria-label="Lead-time waterfall for \d+ launches/);
    for (const r of events.releases) expect(html).toContain(`>${r.model}</text>`);
    expect(html).toContain('no dated market');
    expect(html).toContain('<title>');
  });

  it('release table has a row per launch with sources and leads', async () => {
    const html = await container.renderToString(BacktestReleases, {
      props: { releases: events.releases, crossings: markets.crossings },
    });
    expect(html).toContain('<table');
    expect((html.match(/<th scope="row"/g) ?? []).length).toBe(events.releases.length);
    expect(html).toContain('pre-announced');
    expect(html).toContain('https://news.ycombinator.com/item?id=');
    // Labels that already say "prior to" are not prefixed again.
    expect(html).not.toContain('by On or prior');
  });

  it('release table explains a launch priced only on a far-off rung', async () => {
    const onlyLate: CrossingRow = {
      ...markets.crossings.find((c) => c.id === 'kimi-k3')!,
    };
    const html = await container.renderToString(BacktestReleases, {
      props: { releases: events.releases.filter((r) => r.id === 'kimi-k3'), crossings: [onlyLate] },
    });
    expect(text(html)).toMatch(/only "July 31" \(due \+15\.\dd after\)/);
  });

  it('splits, the 50% claim and false alarms render from the data', async () => {
    const splits = await container.renderToString(BacktestSplits, {
      props: { splits: markets.splits, claim: markets.sevenDayClaim, crossings: markets.crossings },
    });
    const ladder = markets.sevenDayClaim.perLadder.ahead;
    expect(text(splits)).toContain(`gives ${ladder.resolvedYes} of ${ladder.fired}`);
    expect(text(splits)).toContain('11 / 24 (46%)');
    expect(splits).toContain('Pre-announced by the lab');

    const alarms = await container.renderToString(BacktestAlarms, {
      props: { summary: markets.falseAlarms.summary, worst: markets.falseAlarms.worst, limit: 3 },
    });
    expect((alarms.match(/<tr[\s>]/g) ?? []).length).toBe(1 + markets.falseAlarms.summary.length + 1 + 3);
    expect(text(alarms)).toContain(`${markets.falseAlarms.worst.length} No rungs peaked at 0.5 or more`);
  });

  it('scores compare against the base rate and the reliability plots are labelled', async () => {
    const html = await container.renderToString(BacktestScores, {
      props: { calibration: markets.calibration, rungCalibration: markets.rungCalibration },
    });
    expect(html).toContain('max(market, base rate)');
    expect(html).toContain('Brier 24h');
    expect(html).toContain('Brier 72h');
    expect(html).not.toContain('Brier 168h');
    const plots = await container.renderToString(BacktestReliability, {
      props: { horizons: markets.calibration },
    });
    const labels = plots.match(/aria-label="[^"]+"/g) ?? [];
    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain('Reliability of the market forecast at 24 hours');
  });

  it('signal tables carry their evidence links', async () => {
    const b = await container.renderToString(BacktestBroadcasts, {
      props: { broadcasts: broadcasts.broadcasts, misses: broadcasts.misses },
    });
    expect(b).toContain('web.archive.org/web/');
    expect(b).toContain('Every Anthropic launch');

    const a = await container.renderToString(BacktestArchitecture, {
      props: { rows: architecture.architecture, summary: architecture.summary, misses: architecture.misses },
    });
    const shipped = architecture.summary.leads + architecture.summary.coincident + architecture.summary.lags;
    expect(text(a)).toContain(`for ${architecture.summary.leads} of ${shipped} shipped families`);
    expect(a).toContain('qwen4_exp');
    expect(text(a)).toMatch(/\d+d pending/);

    const n = await container.renderToString(BacktestNegatives, {
      props: { results: negatives.results, provenance: negatives.provenance },
    });
    expect(n).toContain('Manifold');
    expect(n).toContain('does not recompute them');

    const tr = await container.renderToString(BacktestTraps, { props: { traps: traps.traps } });
    expect(tr).toContain('id="trap-her"');
    expect(text(tr)).toContain('17 minutes after');
  });

  it('limits block states what the site cannot do', async () => {
    const html = await container.renderToString(BacktestLimits, {
      props: {
        releases: 23,
        dated: 17,
        medianAvailabilityLagH: 0.2,
        early90: 5,
        early90Prompted: 4,
        marketSkill72: -0.49,
      },
    });
    expect(html).toContain("WHAT THIS CAN'T DO");
    expect(text(html)).toContain('12 minutes after its announcement');
    expect(text(html)).toContain('scores worse than');
    expect(text(html)).toContain('Of 5 launches');
  });

  it('reproduce section has the command and copy-pasteable curls', async () => {
    const series = markets.crossings.find((c) => c.id === 'claude-opus-5.5')!.day!;
    const html = await container.renderToString(BacktestReproduce, {
      props: {
        pulledAt: '2026-09-26T00:46:05Z',
        example: {
          model: 'Claude Opus 5.5',
          series,
          hn: { query: 'Opus 5.5', from: '2026-09-19T00:00:00Z', to: '2026-09-24T00:00:00Z' },
          openrouter: 'anthropic/claude-opus-5.5',
        },
      },
    });
    expect(html).toContain('pnpm backtest --refresh');
    expect(html).toContain(`market=${series.token}&amp;startTs=${series.window[0]}`);
    expect(html).toContain('fidelity=60');
    expect(html).toContain('data/backtest/markets.json');
  });
});

describe('backtest page', async () => {
  const container = await AstroContainer.create();

  it('renders every section, links home and cites the pull time', async () => {
    const html = await container.renderToString(BacktestPage);
    for (const id of [
      'leads',
      'splits',
      'false-alarms',
      'calibration',
      'stealth',
      'broadcasts',
      'architecture',
      'negative-results',
      'timestamp-traps',
      'reproduce',
    ]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`href="#${id}"`);
    }
    expect(html).toContain('<title>Backtest · whenmodel</title>');
    expect(html).toContain('href="/"');
    expect(html).toContain(events.meta.pulledAt.slice(0, 10));
    expect((html.match(/role="img"/g) ?? []).length).toBe(4);
  });
});

describe('site copy and links', async () => {
  const container = await AstroContainer.create();

  it('History no longer claims the "her" tweet came the night before, and sources its claims', async () => {
    const html = text(await container.renderToString(History));
    expect(html).not.toContain('night before GPT-4o');
    expect(html).toContain('17 minutes after the GPT-4o announcement');
    expect(html).not.toContain('lag of 3 to 6 weeks');
    expect(html).not.toContain('the drop is usually real');
    expect(html).not.toContain('before the blog post goes up');
    const ladder = markets.sevenDayClaim.perLadder.ahead;
    expect(html).toContain(`shipped on time ${ladder.resolvedYes} of ${ladder.fired} times`);
    expect(html).toContain("xAI's release notes");
    expect(html).toContain("What can't it do?");
    expect(html).toContain('Read the backtest');
    // The auto-refresh answer belongs to another package and stays as it was.
    expect(html).toContain('The page reloads itself every 5 minutes while open.');
  });

  it('the "her" minutes in History agree with the decoded tweet id', () => {
    const her = traps.traps.find((x) => x.id === 'her')!;
    expect(her.example).toContain('17 minutes after');
  });

  it('Footer links the backtest', async () => {
    const html = await container.renderToString(Footer, { props: { generatedAt: '2026-09-26T00:00:00Z' } });
    expect(html).toContain('href="/backtest"');
  });

  it('sitemap lists /backtest', async () => {
    const { GET } = await import('../../src/pages/sitemap.xml');
    const body = await (GET as unknown as () => Response)().text();
    expect(body).toContain('<loc>https://whenmodel.com/</loc>');
    expect(body).toContain('<loc>https://whenmodel.com/backtest</loc>');
  });
});
