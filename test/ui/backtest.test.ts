import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import type { Backtest, CrossingRow } from '../../scripts/backtest/build';
import type { Replay } from '../../scripts/backtest/replay';
import { pct } from '../../scripts/backtest/view';
import BacktestAlarms from '../../src/components/BacktestAlarms.astro';
import BacktestArchitecture from '../../src/components/BacktestArchitecture.astro';
import BacktestBroadcasts from '../../src/components/BacktestBroadcasts.astro';
import BacktestByLab from '../../src/components/BacktestByLab.astro';
import BacktestFormulas from '../../src/components/BacktestFormulas.astro';
import BacktestLimits from '../../src/components/BacktestLimits.astro';
import BacktestReplay from '../../src/components/BacktestReplay.astro';
import BacktestStealth from '../../src/components/BacktestStealth.astro';
import { WEIGHTS } from '../../src/domain/dropcon';
import { FORECAST_CONSTANTS, LEAD_INPUT_SKILL_7D } from '../../src/domain/forecast';
import { TRUSTED_BRACKET_DAYS } from '../../src/domain/market';
import { LAUNCH_SETTLE_MS } from '../../src/domain/lab-status';
import { REVEAL_STATS, REVEALS } from '../../src/domain/stealth';
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
import replayJson from '../../data/backtest/v3-replay.json';

const events = releaseJson as unknown as Backtest['release-events'];
const markets = marketsJson as unknown as Backtest['markets'];
const broadcasts = broadcastsJson as unknown as Backtest['broadcasts'];
const architecture = architectureJson as unknown as Backtest['architecture'];
const negatives = negativesJson as unknown as Backtest['negative-results'];
const traps = trapsJson as unknown as Backtest['timestamp-traps'];
const replay = replayJson as unknown as Replay;

/** The page's signed numbers: a real minus sign, a plus on positives. */
const signed = (n: number, digits: number) =>
  n > 0 ? `+${n.toFixed(digits)}` : n < 0 ? `−${Math.abs(n).toFixed(digits)}` : '0';
const signed2 = (n: number) => signed(n, 2);
const signed3 = (n: number) => signed(n, 3);

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
    // Astra's wordless teaser video is shown as set aside, not used as the announcement.
    expect(text(html)).toContain('Not the launch: "Open AI X post on Astra"');
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
    // Astra's Sep 3 rungs top the list, but Astra was announced on Sep 3: flagged, not read as a day-early miss.
    expect(markets.falseAlarms.worst[0]).toMatchObject({ label: 'September 3', announcedInTime: true });
    expect(text(alarms)).toContain(
      "resolved No under the market's own release rule (OpenAI's Astra released on...?",
    );
  });

  it("keeps wave 1's rung calibration, which v3 does not supersede, and drops its in-sample any-launch table", async () => {
    const html = await container.renderToString(BacktestScores, {
      props: { rungCalibration: markets.rungCalibration },
    });
    for (const r of markets.rungCalibration) {
      // Skill sits next to the row header so it stays on screen when the table scrolls on a phone.
      expect(text(html)).toContain(
        `${r.horizonH}h ${signed3(r.market.skill)} ${r.market.brier.toFixed(4)} ${r.rungs} ${pct(r.yesRate)}`,
      );
    }
    expect(text(html)).toContain('wave-1 pull');
    expect(text(html)).toContain('the markets beat their base rate');
    // Superseded by the out-of-sample v3 replay: the in-sample "market max" and blended rows are gone.
    expect(html).not.toContain('max(market, base rate)');
    expect(html).not.toContain('edges ahead');
  });

  it('draws each reliability panel with its bin counts, a reference line and a table twin', async () => {
    const d72 = replay.horizons.find((h) => h.horizonH === 72)!.formulas.find((f) => f.id === 'noisy-or')!;
    const html = await container.renderToString(BacktestReliability, {
      props: {
        panels: [
          {
            title: 'v3 panel',
            bins: d72.reliability,
            unit: 'hours',
            reference: { value: 0.631, label: 'held-out rate 63%' },
            description: 'The v3 forecast.',
          },
          {
            title: 'rung panel',
            bins: markets.rungCalibration[1].reliability,
            unit: 'rungs',
            description: 'Polymarket rungs.',
          },
        ],
      },
    });
    const labels = html.match(/role="img" aria-label="[^"]+"/g) ?? [];
    expect(labels).toHaveLength(2);
    const total = d72.reliability.reduce((a, b) => a + b.n, 0);
    expect(labels[0]).toContain(`The v3 forecast. Over ${total} hours in ${d72.reliability.length} bins.`);
    // The largest miss is named from the data: the 90–100% bin at 72h.
    const top = d72.reliability[d72.reliability.length - 1];
    expect(labels[0]).toContain(
      `${top.n} hours with a mean forecast of ${pct(top.meanForecast)} came true ${pct(top.observed)}`,
    );
    for (const b of d72.reliability) expect(html).toContain(`>${b.n}</text>`);
    expect(html).toContain('held-out rate 63%');
    expect((html.match(/<caption[\s>]/g) ?? []).length).toBe(2);
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
        early90Unprompted: ['Gemini 3.5 Flash'],
        byPrecursor: markets.splits.byPrecursor,
        marketSkill72: -0.309,
        marketSkill72Ci: [-0.827, 0.056],
        heldOut: 25,
        admitDays: 14,
      },
    });
    expect(html).toContain("WHAT THIS CAN'T DO");
    expect(text(html)).toContain('12 minutes after its announcement');
    expect(text(html)).toContain('scored −0.309 (95% interval −0.83 to +0.06)');
    // One rule both ways: an interval spanning zero is "not distinguishable", even below zero.
    expect(text(html)).toContain('not distinguishable from it');
    expect(text(html)).not.toContain('worse than the guess');
    expect(text(html)).toContain('Of 5 launches');
    // The leak claim states its threshold and n, and the 0.5 split that cuts the other way.
    const none = markets.splits.byPrecursor.find((g) => g.group === 'none')!;
    const leak = markets.splits.byPrecursor.find((g) => g.group === 'leak')!;
    expect(text(html)).toContain(
      'At 90%, most early markets followed a public leak or notice; at 50%, they did not need one.',
    );
    expect(text(html)).toContain('Gemini 3.5 Flash had no such precursor on HN');
    expect(text(html)).toContain(
      `At 0.5, markets crossed ahead of ${none.ahead50} of ${none.events} launches with no public precursor and ${leak.ahead50} of ${leak.events} leaked ones.`,
    );
    expect(text(html)).not.toContain('aggregate leaks rather than foresee launches');
    const clear = await container.renderToString(BacktestLimits, {
      props: {
        releases: 23,
        dated: 17,
        medianAvailabilityLagH: 0.2,
        early90: 5,
        early90Prompted: 4,
        early90Unprompted: [],
        byPrecursor: [],
        marketSkill72: -0.4,
        marketSkill72Ci: [-0.8, -0.1],
        heldOut: 25,
        admitDays: 14,
      },
    });
    expect(text(clear)).toContain('worse than the guess');
    expect(text(html)).toContain('25 held-out launches in the replay, and 23 hand-timed launches');
    expect(text(html)).toContain("can't rebuild the level itself");
    expect(text(html)).toContain('only from 14 days before its deadline');
    // The launched-family window comes from the domain constant, not the copy.
    expect(text(html)).toContain(`drops out for ${LAUNCH_SETTLE_MS / 86_400_000} days`);
    expect(html).toContain('href="#results"');
    // v3: launches can only remove a family from P7, and the level was never tested.
    expect(text(html)).not.toContain('Recent launches raise it');
    expect(text(html)).toContain('A launch never raises it');
    expect(text(html)).toContain('Brier skill of −1.48 (95% interval −3.36 to −0.28)');
    expect(text(html)).toContain('The level itself has not been evaluated');
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
    // Only the computed tables are rebuilt; the curated ones are carried, and the page says so.
    expect(text(html)).toContain('Every computed table is rebuilt from raw pulls committed to the repo.');
    expect(text(html)).toContain('are carried as sourced data, not recomputed');
    expect(text(html)).not.toContain('Everything on this page is regenerated');
    // Algolia answers 400 to an unencoded numericFilters, so the pasted line must carry it encoded.
    expect(html).toContain('numericFilters=created_at_i%3E%3D');
    expect(text(html)).not.toMatch(/created_at_i[<>]=/);
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
      'replay',
      'results',
      'leads',
      'splits',
      'false-alarms',
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
    // Waterfall and replay (wide and narrow layouts each), and the two reliability panels.
    expect((html.match(/role="img"/g) ?? []).length).toBe(6);
    // The stealth placeholder is gone; the anchors other pages link to survive.
    expect(html).not.toContain('will be published here');
    for (const anchor of ['id="trap-her"', 'id="seven-day"', 'id="negative-results"'])
      expect(html).toContain(anchor);
    // The page wears the backtest footer: back to the dashboard, the pull time and the rebuild.
    const footer = html.slice(html.indexOf('<footer'));
    expect(footer).toContain('◂ DASHBOARD');
    expect(footer).toContain(`DATA PULLED ${events.meta.pulledAt.replace('T', ' ').slice(0, 16)}Z`);
    expect(footer).toContain('href="#reproduce"');
    expect(footer).not.toContain('EDGE-CACHED');
  });

  it('opens on the question, the method and the headline results, all from the replay and the shipped constants', async () => {
    const html = text(await container.renderToString(BacktestPage));
    const hero = html.slice(html.indexOf('BACKTEST'), html.indexOf("WHAT THIS CAN'T DO"));
    expect(hero).toContain('Can public signals see a frontier model launch coming?');
    expect(hero).toContain(
      `fitted on the first ${FORECAST_CONSTANTS.fittedOn.events} frontier launches and scored on the next ${FORECAST_CONSTANTS.testedOn.events}`,
    );
    expect(hero).toContain('1 Apr 2026 to 26 Sep 2026');
    expect(hero).toContain(`Plus ${events.releases.length} launches timed by hand`);
    const d = replay.decision;
    expect(hero).toContain(
      `Best 72h skill ${signed3(d.skill)} needed ${signed2(replay.meta.protocol.decisionMinSkill)}`,
    );
    expect(hero).toContain(`95% ${signed2(d.skillCi95[0])} to ${signed2(d.skillCi95[1])}`);
    expect(hero).toContain(`${replay.pricedEvents.testPriced} / ${replay.pricedEvents.test}`);
    expect(hero).toContain(`Level's input, 7d ${signed2(LEAD_INPUT_SKILL_7D.skill)}`);
    // The fourth tile is the sample size, chosen in advance, not the two best labs after the fact.
    expect(hero).toContain(
      `Held-out launches ${FORECAST_CONSTANTS.testedOn.events} the real sample size · fitted on ${FORECAST_CONSTANTS.fittedOn.events}`,
    );
    expect(hero).not.toContain('Best lab reads');
    expect(hero).toContain(
      'No formula beat the base rate at 72 hours, so DROPCON stays a hand-weighted lead score, not a probability.',
    );
    // The best two labs are named as anecdotes, from the data, with their launch counts.
    const [first, second] = [...replay.byLab].sort((a, b) => b.skill - a.skill);
    const counts = replay.byLab.map((l) => l.testEvents);
    expect(hero).toContain(
      `Anthropic (${first.testEvents} launches) and OpenAI (${second.testEvents}) scored highest on their own launches, ${signed2(first.skill)} and ${signed2(second.skill)}`,
    );
    expect(hero).toContain(
      `with ${Math.min(...counts)} to ${Math.max(...counts)} launches per lab these are anecdotes, not a ranking`,
    );
    expect(hero).not.toMatch(/helped/);
    // What was timed by hand, named, instead of "every signal that might have warned".
    expect(hero).toContain('timed by hand against Hacker News, lab feeds, TestingCatalog');
    expect(hero).not.toContain('every signal');
    expect(hero).toContain(
      `${replay.pricedEvents.test - replay.pricedEvents.testPriced} of ${replay.pricedEvents.test}, had no market at 50% or more`,
    );
  });

  it("labels wave-1 sections and keeps v3's replay limits in the results", async () => {
    const html = text(await container.renderToString(BacktestPage));
    expect(html).toContain(`WAVE 1 · ${events.releases.length} LAUNCHES TIMED BY HAND`);
    expect(html).toContain("Wave 1 · Polymarket's own calibration");
    expect(html).toContain('V3 REPLAY · HELD OUT 16 Jul 2026 – 26 Sep 2026');
    const head = replay.horizons.find((h) => h.horizonH === 72)!;
    expect(html).toContain(
      `${head.test.hours.toLocaleString('en-US')} held-out hours hold only ${head.test.events} launches`,
    );
    expect(html).toContain(
      `All ${replay.survivorship.curatedStillListed} of ${replay.survivorship.curatedFrontierLaunches} hand-curated frontier launches`,
    );
    expect(html).toContain(`in the last ${replay.meta.protocol.admitDays} days are censored low`);
    expect(html).toContain('No historical bid or ask.');
    expect(html).toContain(
      `a median ${replay.settlementLag.medianH} hours (up to ${replay.settlementLag.maxH} hours, over ${replay.settlementLag.events} markets)`,
    );
    for (const l of replay.meta.limitations) expect(html).toContain(l.slice(0, 40));
  });
});

describe('v3 replay components', async () => {
  const container = await AstroContainer.create();
  const h72 = FORECAST_CONSTANTS.horizons.find((h) => h.horizonHours === 72)!;
  const h7d = FORECAST_CONSTANTS.horizons.find((h) => h.horizonHours === 168)!;

  it('draws the replay as an accessible SVG from the committed series, in both layouts', async () => {
    const html = await container.renderToString(BacktestReplay, { props: { replay } });
    const labels = [...html.matchAll(/<svg viewBox="[^"]+" role="img" aria-label="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(labels).toHaveLength(2);
    expect(labels[0]).toBe(labels[1]);
    const label = text(labels[0]);
    expect(label).toContain('Hourly replay from 2026-04-01 to 2026-09-26, drawn every 3 hours');
    expect(label).toContain(
      `(${FORECAST_CONSTANTS.fittedOn.events} launches, a 72-hour rate of ${pct(h72.baseRate)})`,
    );
    expect(label).toContain(
      `(${FORECAST_CONSTANTS.testedOn.events} launches, a rate of ${pct(h72.test.rate)})`,
    );
    expect(label).toContain(
      `Only ${replay.pricedEvents.testPriced} of the ${replay.pricedEvents.test} held-out launches`,
    );
    // Both series are drawn once, in data units, and reused by each layout.
    const paths = [...html.matchAll(/<path id="bt-replay-(\w+)" d="([^"]+)"/g)];
    expect(paths.map((p) => p[1])).toEqual(['p72', 'lead7']);
    for (const [, id, d] of paths) {
      const values = id === 'p72' ? replay.series.p : replay.series.lead7;
      expect((d.match(/l1 /g) ?? []).length).toBe(values.length - 1);
      expect(d.startsWith(`M0 1000V${Math.round(1000 - values[0] * 1000)}`)).toBe(true);
    }
    expect((html.match(/href="#bt-replay-p72"/g) ?? []).length).toBe(4);
    // Base-rate lines come from the shipped constants.
    expect(text(html)).toContain(`fit rate ${pct(h72.baseRate)}`);
    expect(text(html)).toContain(`held out ${pct(h72.test.rate)}`);
    expect(text(html)).toContain(`fit rate ${pct(h7d.baseRate)}`);
    expect(text(html)).toContain(`held out ${pct(h7d.test.rate)}`);
    // One marker per frontier launch in each layout, priced ones filled.
    expect((html.match(/<g class="mark"/g) ?? []).length).toBe(2 * replay.releases.markers.length);
    const priced = replay.pricedEvents.events.filter((e) => e.priced).length;
    expect((html.match(/class="launch priced"/g) ?? []).length).toBe(2 * priced + 1);
  });

  it('names the longest false alarm from the series and has a weekly table twin', async () => {
    const html = await container.renderToString(BacktestReplay, { props: { replay } });
    // Grok 4.7's day buckets: the forecast sat at 90%+ from 12 to 16 Sep and nothing listed until the 21st.
    expect(text(html)).toContain(
      'The longest false alarm: the forecast held 90% or more from 12 Sep to 16 Sep',
    );
    expect(text(html)).toContain('≥90% for 4.6 days, nothing listed');
    const weeks = Math.ceil(replay.series.p.length / 56);
    const table = html.slice(html.indexOf('<details class="weeks"'));
    expect((table.match(/<th scope="row"/g) ?? []).length).toBe(weeks);
    expect(text(table)).toContain('▲ claude-opus-5.5');
    expect(text(table)).toContain('fit / held out');
  });

  it('marks a launch as unpriced when its lab never priced it, and survives a replay without a false alarm', async () => {
    const quiet = {
      ...replay,
      series: {
        ...replay.series,
        p: replay.series.p.map(() => 0.3),
        lead7: replay.series.lead7.map(() => 0.2),
      },
    };
    const html = await container.renderToString(BacktestReplay, { props: { replay: quiet } });
    expect(html).not.toContain('class="alarm"');
    expect(text(html)).not.toContain('longest false alarm');
    const qwen = replay.pricedEvents.events.find((e) => !e.priced)!;
    expect(text(html)).toContain(
      `Its own lab's 72-hour read peaked at ${pct(qwen.maxLabP72)} in the 72 hours before it listed (not priced ≥50%)`,
    );
    // A launch with a read below the bar was priced, just not at 50%: never "no market priced it".
    expect(text(html)).not.toContain('no market priced');
    expect(text(html)).toContain('launch not priced ≥50%');
    expect(text(html)).toContain(`the input behind ${WEIGHTS.market7d} of DROPCON's 100 points`);
    const held = replay.pricedEvents.events.filter((e) => e.at > replay.meta.split.at);
    expect(text(html)).toContain(
      `${held.filter((e) => !e.priced).length} of the ${held.length} held-out launches had no market at 50% or more beforehand`,
    );
  });

  it('scores formulas (a)–(e) at every horizon with skill, interval and the sanity flag, and states the rule', async () => {
    const html = await container.renderToString(BacktestFormulas, {
      props: {
        horizons: replay.horizons,
        decision: replay.decision,
        protocol: replay.meta.protocol,
        headlineH: 72,
      },
    });
    const t = text(html);
    for (const h of replay.horizons)
      for (const f of h.formulas.filter((x) => x.id !== 'base')) {
        expect(t).toContain(
          `${signed3(f.skill)} ${signed2(f.skillCi95[0])} to ${signed2(f.skillCi95[1])} ${f.sanity.sane ? 'sane' : 'fails sanity'}`,
        );
      }
    // The 72h column decides and comes first.
    expect(t.indexOf('Next 72h · decides')).toBeLessThan(t.indexOf('Next 24h'));
    const d = replay.decision;
    expect(t).toContain(
      `by more than ${signed2(replay.meta.protocol.decisionMinSkill)} with sane reliability`,
    );
    expect(t).toContain(
      `${signed3(d.skill)} (95% interval ${signed3(d.skillCi95[0])} to ${signed3(d.skillCi95[1])}), and its worst bin was off by ${d.worstBinGap.toFixed(2)}`,
    );
    expect(t).toContain('Verdict: keep the hand-weighted lead score');
    expect(t).toContain(
      `(d) scored ${d.rollingSkill.map(signed3).join(', ')} across the 4 folds: the sign flips`,
    );
    const head = replay.horizons.find((h) => h.horizonH === 72)!;
    for (const s of head.sensitivity) expect(t).toContain(`${s.variant}`);
    const nb = head.sensitivity.find((s) => s.variant === 'no-buckets')!.formulas['noisy-or'].skill;
    expect(t).toContain(`moves it by ${signed2(nb - d.skill)}`);
    expect(t).toContain('none passes the sanity check');
  });

  it('ranks labs by their own skill with launch counts, and shows the levels did not rank outcomes', async () => {
    const html = await container.renderToString(BacktestByLab, {
      props: {
        byLab: replay.byLab,
        priced: replay.pricedEvents,
        pricedMin: replay.meta.protocol.pricedMin,
        readMin: replay.meta.protocol.readMin,
        levels: replay.levels,
        split: replay.meta.split.at,
        headlineH: 72,
      },
    });
    const t = text(html);
    const names = [...html.matchAll(/<th scope="row"[^>]*>([^<]+)<\/th>/g)]
      .map((m) => m[1])
      .slice(0, replay.byLab.length);
    expect(names.slice(0, 2)).toEqual(['Anthropic', 'OpenAI']);
    for (const l of replay.byLab) expect(t).toContain(signed3(l.skill));
    expect(t).toContain(`(${replay.pricedEvents.testPriced} of ${replay.pricedEvents.test} overall)`);
    expect(t).toContain(`read above ${pct(replay.meta.protocol.readMin)}`);
    const counts = replay.byLab.map((l) => l.testEvents);
    expect(t).toContain(`With ${Math.min(...counts)} to ${Math.max(...counts)} launches per lab`);
    const [l1] = replay.levels.test;
    expect(t).toContain(
      `did not rise with the level: level 1 hours were followed by a launch ${pct(l1.observed)} of the time`,
    );
  });

  it('reports the stealth track record from REVEAL_STATS and lists every reveal', async () => {
    const html = await container.renderToString(BacktestStealth);
    const t = text(html);
    expect(t).toContain(`Revealed slots ${REVEAL_STATS.all.n}`);
    expect(t).toContain(`Median days in stealth ${REVEAL_STATS.all.medianDays.toFixed(1)}`);
    expect(t).toContain(
      `Frontier-lab slots ${REVEAL_STATS.frontier.n} median ${REVEAL_STATS.frontier.medianDays.toFixed(1)} days`,
    );
    expect((html.match(/<th scope="row"/g) ?? []).length).toBe(REVEALS.length);
    expect((html.match(/class="tag frontier"/g) ?? []).length).toBe(REVEAL_STATS.frontier.n);
    for (const r of REVEALS.filter((x) => !x.verified))
      expect(t).toContain(`${r.slot} is shown but left out`);
    expect(t).toContain('unverified, left out of the medians');
    for (const r of REVEALS) expect(html).toContain(`href="${r.source}"`);
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
    // Only SDK release feeds were timed against launches; config strings and API errors were not.
    expect(html).toContain('SDK releases land with it or after it: 5 of 7 lagged');
    const ladder = markets.sevenDayClaim.perLadder.ahead;
    expect(html).toContain(`shipped on time ${ladder.resolvedYes} of ${ladder.fired} times`);
    expect(html).toContain("xAI's release notes");
    expect(html).toContain("What can't it do?");
    expect(html).toContain('Read the backtest');
    expect(html).not.toContain('measures all of it');
    expect(html).not.toContain('How it was tested');
    expect(html).toContain('The weights are hand-set and the level itself has never been tested');
    // The FAQ's weights and trust window are the scorer's own constants.
    expect(html).toContain(
      `${WEIGHTS.market7d} × the best 7-day probability, plus ${WEIGHTS.market30dIncrement} × whatever the best 30-day probability adds, plus up to ${WEIGHTS.repricing} when`,
    );
    expect(html).toContain(`more than ${TRUSTED_BRACKET_DAYS} days out`);
    expect(html).toContain(`the input behind ${WEIGHTS.market7d} of the 100 points`);
    expect(html).toContain('(Brier skill −1.48 (95% interval −3.36 to −0.28))');
    // The auto-refresh answer belongs to WP-8 (polled refresh) and stays as that package wrote it.
    expect(html).toContain('The open page checks for new data every 5 minutes and offers a one-click reload');
    expect(html).not.toContain('The page reloads itself every 5 minutes while open.');
  });

  it('never says anything but the markets feeds the level (FAQ and timeline)', async () => {
    const html = text(await container.renderToString(History));
    const faq = html.slice(html.indexOf('FREQUENTLY ASKED QUESTIONS'));
    expect(faq).toContain('Its headline level, DROPCON, reads Polymarket release odds only.');
    expect(faq).toContain('are shown beside it with their track records and never move it');
    expect(html).not.toMatch(
      /condensed into one readiness level|fuses free public signals|DROPCON does the reading/,
    );
    expect(html).toContain('DROPCON reads the markets; the rest is shown, not scored.');
    expect(html).not.toContain('calibrated 72-hour');
    // The arena card carries the one measurement the site has, not an unmeasured lead.
    expect(html).not.toContain('somebody is about to ship');
    expect(html).toContain('Design Arena, purged its codenames in June 2026');
    // The leak claim no longer says the markets never move ahead of launches.
    expect(html).not.toContain('move on leaks rather than ahead of them');
  });

  it('says which broadcast times rest on an archive and which on YouTube, and relabels "surprise"', async () => {
    const html = text(await container.renderToString(BacktestPage));
    const archived = broadcasts.broadcasts.filter((b) => b.capture).length;
    expect(html).toContain(
      `${archived} of these ${broadcasts.broadcasts.length} have an archived copy proving it was up before the stream; GPT-5.6 is timed from YouTube's own publishedAt, with no archive.`,
    );
    expect(html).not.toContain('These are the cases where an archived copy proves');
    expect(html).toContain('PRE-ANNOUNCED, LEAKED OR NO HN PRECURSOR');
    expect(html).toContain('No HN precursor');
    expect(html).not.toMatch(/surprise/i);
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
