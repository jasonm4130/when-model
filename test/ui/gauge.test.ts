import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import Dropcon from '../../src/components/Dropcon.astro';
import DropconScope from '../../src/components/DropconScope.astro';
import Labs from '../../src/components/Labs.astro';
import Signals from '../../src/components/Signals.astro';
import Layout from '../../src/layouts/Layout.astro';
import { assembleDashboard, type Dashboard, type DashboardInputs } from '../../src/domain/dashboard';
import type { Drop } from '../../src/domain/drop';
import { buildInstrument } from '../../src/domain/instrument';
import type { Market } from '../../src/domain/market';
import { SOURCE } from '../../src/domain/sources';
import { dropconTitle } from '../../src/ui/odds';
import type { ScrubData } from '../../src/ui/readout';
import { TRACK_LINES } from '../../src/ui/signals';
import { readings, series } from '../fixtures/history';
import { warnings } from '../fixtures/warnings';

const NOW = Date.parse('2026-09-26T12:00:00Z');

const sonnet: Market = {
  slug: 'next-claude-sonnet',
  title: 'Next Claude Sonnet released by...?',
  url: 'https://polymarket.com/event/next-claude-sonnet',
  vol24: 50_000,
  volume: 1e6,
  kind: 'release',
  labId: 'anthropic',
  outcomes: [
    {
      label: 'September 30',
      yes: 0.8,
      endDate: '2026-10-01T00:00:00Z',
      closed: false,
      vol24: 100,
      deadline: '2026-10-01T03:59:59.000Z',
      deadlineKind: 'by',
      bestBid: 0.795,
      bestAsk: 0.805,
      thin: false,
      liquidity: 1000,
    },
  ],
};
const opus: Drop = {
  id: 'anthropic/claude-opus-5.5',
  name: 'Anthropic: Claude Opus 5.5',
  lab: 'Anthropic',
  labId: 'anthropic',
  createdAt: '2026-09-22T12:00:00Z',
  url: 'https://openrouter.ai/anthropic/claude-opus-5.5',
  free: false,
  textOutput: true,
};

function dashboard(overrides: Partial<DashboardInputs> = {}): Dashboard {
  return assembleDashboard(
    {
      markets: { name: SOURCE.polymarket, data: [sonnet], ok: true },
      drops: { name: SOURCE.openrouter, data: [opus], ok: true },
      trending: { name: SOURCE.hfTrending, data: [], ok: true },
      papers: { name: SOURCE.hfPapers, data: [], ok: true },
      feeds: [{ name: SOURCE.hackerNews, data: [], ok: true }],
      ...overrides,
    },
    NOW,
  );
}
const floorInputs = { markets: { name: SOURCE.polymarket, data: [], ok: false, error: 'down' } };
const darkInputs = { ...floorInputs, drops: { name: SOURCE.openrouter, data: [], ok: false, error: 'down' } };

const container = await AstroContainer.create();
const render = (component: Parameters<typeof container.renderToString>[0], props: Record<string, unknown>) =>
  container.renderToString(component, { props });

const v2 = readings('2026-09-23T00:00:00Z', 72, 2, (i) => (i < 24 ? 90 : 64));
const v3 = readings('2026-09-26T00:00:00Z', 12, 3, (i) => (i < 6 ? 60 : 30));

/** The instrument the component draws for these props, from the same pure builder. */
const model = (d: Dashboard, points: ReturnType<typeof series>, ok = true) =>
  buildInstrument({
    points,
    ok,
    now: NOW,
    currentVersion: d.measurement.algorithmVersion,
    live: { state: d.dropcon.state, score: d.dropcon.score, level: d.dropcon.level, at: d.generatedAt },
    launches: d.landed.releases.map((r) => ({
      at: r.firstListedAt,
      labId: r.labId,
      lab: r.lab,
      name: r.name,
    })),
  });

/** The scrubber data the component embeds, parsed back out of its attribute. */
const scopeData = (html: string) =>
  JSON.parse(
    html
      .match(/data-scope="([^"]*)"/)![1]
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&'),
  ) as ScrubData;

describe('DropconScope: the level and its week as one instrument', () => {
  const d = dashboard();

  it('renders an intentional empty state, with the live level still at the NOW edge', async () => {
    const html = await render(DropconScope, { d, history: { ok: true, points: [] }, now: NOW });
    expect(html).toMatch(
      /class="sc-plot" data-plot role="img" aria-label="DROPCON history, the lead score over the last 7 days/,
    );
    expect(html).toContain('NO READINGS YET');
    expect(html).toContain('v3 history starts 26 Sep: the 15-minute capture writes the first point.');
    expect(html).not.toContain('class="sc-line"');
    expect(html).toMatch(new RegExp(`class="dc-num head" data-num[^>]*>${d.dropcon.level}<`));
    expect(html).toContain(`--y:${100 - d.dropcon.score}`);
    // The readout starts at NOW, from the same function the browser runs.
    expect(html).toMatch(/data-r-when[^>]*>NOW · 26 SEP 12:00Z</);
    expect(html).toMatch(new RegExp(`data-r-what[^>]*>score ${d.dropcon.score} → level ${d.dropcon.level}<`));
    expect(scopeData(html)).toMatchObject({ history: 'empty', pts: [], launchesOk: true });
  });

  it('degrades to an offline plot, never throwing, when the history is missing', async () => {
    const html = await render(DropconScope, { d, now: NOW });
    expect(html).toContain('HISTORY OFFLINE');
    expect(html).toContain('hist-unavailable');
    expect(html).toContain('The score series could not be read; the level shown is live.');
    expect(html).toContain('<td colspan="3"');
    expect(html).toContain('The score series could not be read.</td>');
    const data = scopeData(html);
    expect(data).toMatchObject({ history: 'unavailable', pts: [] });
    expect(data.live).toMatchObject({ state: 'ok', score: d.dropcon.score, level: d.dropcon.level });
    // The big number is the live reading all the same.
    expect(html).toMatch(new RegExp(`class="dc-num head" data-num[^>]*>${d.dropcon.level}<`));
  });

  it('draws an old version as a labelled hatch, never a line, and calls a young v3 line what it is', async () => {
    const points = series(v2, v3);
    const inst = model(d, points);
    const html = await render(DropconScope, { d, history: { ok: true, points }, now: NOW });
    // The label comes whole at three widths; the plot shows the one that fits.
    expect(html).toMatch(/class="sc-zone old"[^>]*>.*v2 · OLD SCALE.*another formula, not comparable/s);
    expect(html).toMatch(/class="zl-min"[^>]*>v2</);
    // One line, the v3 stretch, the same path the builder draws; it runs into the live reading.
    expect(html.match(/class="sc-line"/g)).toHaveLength(1);
    expect(html).toContain(`d="${inst.traces[0].line}"`);
    expect(inst.now.joined).toBe(true);
    expect(html).toContain('class="sc-dot joined"');
    // v3 has 12 hours, so its start is a callout with an honest count.
    expect(inst.current).toMatchObject({ count: 12, young: true });
    // The series is hourly and a version's first hour can hold the old one too: the start is an hour.
    expect(html).toContain('v3 SCALE FROM THE 26 SEP 00:00Z HOUR');
    expect(html).toContain('v3 FROM 00:00Z HOUR');
    expect(html).toContain('12 hourly readings so far');
    expect(html).toContain('updates every 15 min');
    // It stepped from level 2 to level 4 at 06:00, and held: a flag on the line, hung below the
    // corner of a step down. The time is its own span, so a phone can show just "▼ L4".
    expect(html).toMatch(
      /class="sc-change l4 left"[^>]*data-side="below" data-side0="below"[^>]*><span class="cf-dir"[^>]*>▼ L4<\/span><span class="cf-when"[^>]*> 26 SEP 06:00Z</,
    );
    // v2 starts inside the window: the dark stretch before it is the record's start.
    expect(html).toContain('captures start 23 Sep');
    expect(html).toContain(`aria-label="${inst.summary}"`);
    // Which way is hot, at the plot's top and bottom.
    expect(html).toContain('▲ 1 · RELEASE SURGE');
    expect(html).toContain('▼ 5 · QUIET ORBIT');
    // The table keeps every number: the live reading first, then v3, then v2 marked old.
    expect(html).toMatch(/<td[^>]*>NOW · 26 Sep 12:00Z<\/td><td[^>]*>\d+<\/td>/);
    expect(html).toContain('90 (v2, old scale)');
    // The scrubber gets the readings but not the live one: that answers only at NOW.
    const data = scopeData(html);
    expect(data.pts.filter((p) => p[0] === 'o')).toHaveLength(72);
    expect(data.pts.filter((p) => p[0] === 'c')).toHaveLength(12);
    expect(data.pts.every((p) => p[2] > p[1])).toBe(true);
    expect(data.live).toEqual({
      state: 'ok',
      at: Date.parse(d.generatedAt),
      score: d.dropcon.score,
      level: d.dropcon.level,
    });
  });

  it('shows an old version alone as the hatch, with no line and no current-scale tag', async () => {
    const points = series(v2);
    const html = await render(DropconScope, { d, history: { ok: true, points }, now: NOW });
    expect(html).not.toContain('class="sc-line"');
    expect(html).not.toContain('class="sc-v3');
    expect(html).toContain('No v3 readings recorded yet.');
    expect(html).toContain('class="sc-zone old"');
  });

  it("marks this week's frontier launches on the rail and names them in the plot", async () => {
    const html = await render(DropconScope, { d, history: { ok: true, points: series(v3) }, now: NOW });
    const release = d.landed.releases[0];
    expect(release).toBeDefined();
    expect(html).toMatch(
      new RegExp(`class="sc-mark"[^>]*data-launch="0"[^>]*title="${release.name} · ${release.lab} · `),
    );
    expect(html).toMatch(new RegExp(`class="sc-flag[^"]*"[^>]*>.*${release.name}`, 's'));
    expect(html).toContain('<caption class="sr-only"');
    expect(html).toMatch(
      /data-r-near[^>]*>1 frontier launch in 7 days · latest ✱ Claude Opus 5\.5 \(Anthropic\), 22 Sep</,
    );
    expect(scopeData(html).launches).toHaveLength(d.landed.releases.length);
  });

  it('says the launch listings are offline instead of drawing a week with no launches', async () => {
    const down = dashboard({ drops: { name: SOURCE.openrouter, data: [], ok: false, error: 'down' } });
    const html = await render(DropconScope, { d: down, history: { ok: true, points: series(v3) }, now: NOW });
    expect(html).toContain('LAUNCH LISTINGS OFFLINE');
    expect(html).toContain('Launch listings offline: OpenRouter unreachable, launches not marked');
    expect(scopeData(html).launchesOk).toBe(false);
  });

  it('states the score-to-level rule beside the number', async () => {
    const html = await render(DropconScope, { d, history: { ok: true, points: [] }, now: NOW });
    expect(html).toMatch(
      new RegExp(
        `class="sc-eq-score"[^>]*><b[^>]*>${d.dropcon.score}</b><span class="of"[^>]*>/100</span> LEAD SCORE</span>`,
      ),
    );
    expect(html).toContain(`LEVEL ${d.dropcon.level} OF 5</span>`);
    // Stamped on the number itself, so the first screen says it wherever the number is.
    expect(html).toMatch(/class="sc-eq-nf"[^>]*><span class="sr-only"[^>]*>, <\/span>NOT A FORECAST<\/span>/);
    for (const inputs of [floorInputs, darkInputs]) {
      const off = await render(DropconScope, { d: dashboard(inputs), now: NOW });
      expect(off).not.toContain('class="sc-eq-nf"');
    }
  });

  it('offers a hover hint and a tap hint; the stylesheet shows the one that fits the screen', async () => {
    const html = await render(DropconScope, { d, history: { ok: true, points: [] }, now: NOW });
    expect(html).toMatch(/class="h-long"[^>]*>◀ ▶ HOVER, DRAG OR ARROW KEYS</);
    expect(html).toMatch(/class="h-short"[^>]*>◀ TAP<span class="h-drag"[^>]*> OR DRAG<\/span> ▶</);
  });

  it('says when the capture last wrote, not "none yet", when every reading is older than the window', async () => {
    const old = readings('2026-09-10T00:00:00Z', 48, 3, () => 50);
    const html = await render(DropconScope, { d, history: { ok: true, points: series(old) }, now: NOW });
    expect(html).toContain('NO RECENT READINGS');
    expect(html).toContain('Nothing captured in these 7 days; the last reading was 11 Sep 23:10Z.');
    expect(html).not.toContain('NO READINGS YET');
    expect(scopeData(html)).toMatchObject({ history: 'empty', last: Date.parse('2026-09-11T23:10:00Z') });
  });

  it('calls a gap at the window edge "no captures" when the record goes back further', async () => {
    // Recorded from 15 Sep, the capture down 18-21 Sep across the window's left edge (19 Sep 12:00).
    const before = readings('2026-09-15T00:00:00Z', 72, 3, () => 50);
    const after = readings('2026-09-21T00:00:00Z', 132, 3, () => 50);
    const html = await render(DropconScope, {
      d,
      history: { ok: true, points: series(before, after) },
      now: NOW,
    });
    expect(html).not.toContain('captures start');
    expect(html).toMatch(/class="sc-zone unrecorded"[^>]*style="left:0%[^"]*"[^>]*>.*?no captures/s);
    expect(scopeData(html).recordFrom).toBe(Date.parse('2026-09-15T00:00:00Z'));
    expect(html).not.toContain('class="sc-v3');
  });
});

describe('Dropcon for a first-time reader', () => {
  it('shows the level, the scale right under the headline, a linked LEAD provenance and plain disclosure', async () => {
    const d = dashboard();
    const html = await render(Dropcon, { d, history: { ok: true, points: [] }, now: NOW });
    const at = (s: string) => html.indexOf(s);
    expect(at('dc-headline')).toBeLessThan(at('dc-scale'));
    expect(at('dc-scale')).toBeLessThan(at('dc-drivers'));
    expect(html.match(/class="tag lead"[^>]*>LEAD</g)).toHaveLength(d.dropcon.provenance.length);
    const pts = [...html.matchAll(/<span class="pts"[^>]*>(\d+)<\/span>/g)].map((m) => Number(m[1]));
    expect(pts.slice(0, -1).reduce((a, b) => a + b, 0)).toBe(pts.at(-1));
    expect(html).toMatch(
      /Is this a forecast\?<\/b> No — it's a hand-weighted lead score, not a probability\. <a href="\/backtest"/,
    );
    expect(html).toContain('href="/backtest"');
    // Beside the level: the base rate at its own 7-day horizon. The 72-hour rate sits in the note.
    const base = html.slice(html.indexOf('class="dc-base"'), html.indexOf('class="dc-more"'));
    expect(base).toContain('within 7 days in 73% of hours');
    expect(base).toContain('94% of held-out hours');
    expect(base).not.toContain('72-hour');
    const more = html.slice(html.indexOf('class="dc-more"'));
    expect(more).toContain('39% of 72-hour windows');
    expect(more).toContain('63% more recently');
    expect(html).not.toContain('Context, not the level');
    // The score-to-level cut points, from LEVEL_BANDS.
    expect(html).toContain('Levels by score: 1 at 75+, 2 at 55–74, 3 at 35–54, 4 at 15–34, 5 below 15.');
    // The hottest-lab line links to that lab's card, which Labs renders with the same id.
    const hot = d.labs[0];
    expect(html).toContain(`href="#lab-${hot.id}"`);
    expect(html).toContain(`heat ${hot.heat}`);
    expect(await render(Labs, { d })).toContain(`id="lab-${hot.id}"`);
    // Icon glyphs are hidden from the heading's accessible name.
    expect(html).toContain('<span aria-hidden="true" data-astro-cid');
    expect(html).toMatch(/<h2[^>]*><span aria-hidden="true"[^>]*>▣<\/span>DROPCON LEVEL<\/h2>/);
    // One instrument: the number, the rule that sets it, the week that led to it, and what it is.
    expect(html).toContain('LEAD SCORE');
    expect(html).toContain('WHAT IS THIS?');
    expect(html).toContain('the line is that');
    // A phone shows the short form above its readout.
    expect(html).toContain('The line is the 0–100 lead score over time');
    expect(html).toMatch(/It is a lead score, <b class="nf"[^>]*>NOT A FORECAST<\/b>/);
    expect(html).toContain('context only, the score has not been shown to predict launches');
    expect(at('dc-name')).toBeLessThan(at('dc-num'));
    expect(at('dc-num')).toBeLessThan(at('sc-plot'));
    expect(html).not.toContain('DROPCON HISTORY');
    expect(html).not.toContain('COMPOSITE HEAT');
  });

  it('shows a floor muted, named FLOOR (ODDS OFFLINE), with dimmed segments and no lit level', async () => {
    const d = dashboard(floorInputs);
    const html = await render(Dropcon, { d, now: NOW });
    expect(d.dropcon.state).toBe('floor');
    expect(html).toMatch(/class="section wrap reveal dc-hero"[^>]*style="--lvl:var\(--muted\)"/);
    expect(html).toMatch(/class="dc-num head" data-num[^>]*>5</);
    expect(html).toContain('FLOOR (ODDS OFFLINE)');
    expect(html).toContain('class="sc-dot"');
    expect(html).toMatch(/<b class="word"[^>]*>FLOOR<\/b> ODDS OFFLINE/);
    expect(html).toContain('NOT A MEASUREMENT');
    expect(html).toMatch(/data-r-what[^>]*>floor · odds offline, not measured</);
    expect(html).not.toContain('QUIET ORBIT</div>');
    expect(html).toContain('FLOOR · ODDS OFFLINE');
    expect(html).not.toMatch(/class="seg on/);
    expect(html.match(/class="seg dim/g)).toHaveLength(5);
    expect(html).toContain('class="seg dim floor l5"');
    expect(html).toContain('aria-label="DROPCON floor: 5 of 5 with the odds offline"');
    expect(dropconTitle(d.dropcon)).toBe('DROPCON 5 · FLOOR (odds offline) — whenmodel');
    // The hottest-lab line and every lab card say the odds are offline, never "no market".
    expect(html).toContain('odds offline; last listed Claude Opus 5.5');
    expect(html).not.toContain('no market;');
    const labs = await render(Labs, { d });
    expect(labs).toContain('ODDS OFFLINE · POLYMARKET UNREACHABLE');
    expect(labs).not.toContain('NO POLYMARKET RELEASE MARKET');
    expect(labs).toContain('title="odds offline"');
  });

  it('shows "?" and NO SIGNAL with every segment dimmed, and titles the page DROPCON — NO SIGNAL', async () => {
    const d = dashboard(darkInputs);
    const html = await render(Dropcon, { d, now: NOW });
    expect(html).toMatch(/class="section wrap reveal dc-hero"[^>]*style="--lvl:var\(--muted\)"/);
    expect(html).toMatch(/class="dc-num head" data-num[^>]*>\?</);
    expect(html).not.toContain('class="sc-dot');
    expect(html).not.toContain('class="sc-nowtag');
    expect(html).toContain('NO SIGNAL');
    expect(html).toMatch(/data-r-what[^>]*>no signal · odds and listings down</);
    expect(html.match(/class="seg dim l\d"/g)).toHaveLength(5);
    expect(html).toContain('No lab data: Polymarket and OpenRouter are both unreachable.');
    const page = await container.renderToString(Layout, {
      props: { title: dropconTitle(d.dropcon), description: 'd' },
      slots: { default: '<p>x</p>' },
    });
    expect(page).toContain('<title>DROPCON — NO SIGNAL — whenmodel</title>');
  });
});

describe('Labs cards', () => {
  it('flags each lab with the lead signals that name it, linked to the early warnings', async () => {
    const d = { ...dashboard(), earlyWarnings: warnings() };
    const html = await render(Labs, { d });
    const card = (id: string) =>
      html.slice(html.indexOf(`id="lab-${id}"`), html.indexOf('</article>', html.indexOf(`id="lab-${id}"`)));
    expect(card('openai')).toMatch(/class="flag leak" href="#ew-leaks"[^>]*>LEAK ×2</);
    expect(card('openai')).toMatch(/class="flag stream" href="#ew-streams"[^>]*>STREAM 5H</);
    expect(card('openai')).toMatch(/class="flag keynote" href="#ew-events"[^>]*>KEYNOTE 70H</);
    expect(card('qwen')).toMatch(/class="flag arch" href="#ew-arch"[^>]*>ARCH</);
    expect(card('anthropic')).not.toContain('class="flag');
    // A stealth slot has no lab: it is counted once, in the section head, never on a card.
    expect(html).toContain('1 STEALTH SLOT · UNATTRIBUTED');
  });

  it('labels every read trusted or extrapolated with its bracket, and gives the histogram a text alternative', async () => {
    const d = dashboard();
    const html = await render(Labs, { d, now: new Date(NOW) });
    const anthropic = html.slice(html.indexOf('id="lab-anthropic"'));
    const read = (h: string) =>
      new RegExp(
        `class="read trusted"[^>]*><dt[^>]*>${h}</dt><dd[^>]*><span class="trust"[^>]*>trusted</span> <span class="bracket"[^>]*>([^<]*)<`,
      ).exec(anthropic)?.[1];
    // Sonnet's only rung is Sep 30: 72 hours reads toward it, 7 days is past it and held there.
    expect(read('72H')).toBe('now → Sep 30');
    expect(read('7D')).toBe('at least, held Sep 30');
    expect(html).toMatch(
      /class="hist" role="img" aria-label="Models listed on OpenRouter per month: Oct 2025 \d+, [^"]*Sep 2026 \d+\."/,
    );
    expect(html).toMatch(/<h3 class="lab-name head"[^>]*><span class="glyph" aria-hidden="true"/);
  });

  it('says "NO POLYMARKET RELEASE MARKET" only when the odds are up, and "1 LAUNCH" in the singular', async () => {
    const html = await render(Labs, { d: dashboard() });
    expect(html).toContain('NO POLYMARKET RELEASE MARKET');
    expect(html).not.toContain('ODDS OFFLINE');
    const anthropic = html.slice(
      html.indexOf('id="lab-anthropic"'),
      html.indexOf('</article>', html.indexOf('id="lab-anthropic"')),
    );
    expect(anthropic).toMatch(/>1 LAUNCH\/30D</);
    expect(anthropic).not.toContain('1 LAUNCHES');
  });

  it('marks an extrapolated read by its tilde and class, and names a 30-day read from another family', async () => {
    const rung = (label: string, deadline: string, yes: number) => ({
      ...sonnet.outcomes[0],
      label,
      yes,
      deadline,
      endDate: deadline,
      bestBid: yes - 0.005,
      bestAsk: yes + 0.005,
    });
    const google = (slug: string, title: string, outcomes: Market['outcomes']): Market => ({
      ...sonnet,
      slug,
      title,
      url: `https://polymarket.com/event/${slug}`,
      labId: 'google',
      outcomes,
    });
    const flashLite = google('flash-lite', 'Next Google Gemini Flash-Lite released by...?', [
      rung('September 30', '2026-10-01T03:59:59.000Z', 0.075),
      rung('October 31', '2026-11-01T03:59:59.000Z', 0.08),
    ]);
    const gemini4 = google('gemini-4', 'Gemini 4.0 released by...?', [
      rung('September 30', '2026-10-01T03:59:59.000Z', 0.03),
      rung('October 31', '2026-11-01T03:59:59.000Z', 0.79),
    ]);
    // xAI: one rung two months out, so every read of it is extrapolated.
    const grok = {
      ...google('grok', 'Next Grok released by...?', [rung('November 30', '2026-12-01T04:59:59.000Z', 0.5)]),
      labId: 'xai' as const,
    };
    const d = dashboard({
      markets: { name: SOURCE.polymarket, data: [sonnet, flashLite, gemini4, grok], ok: true },
    });
    const g = d.labs.find((l) => l.id === 'google')!;
    expect(g.odds?.family).toBe('Next Google Gemini Flash-Lite');
    expect(g.odds?.p30.family).toBe('Gemini 4.0');
    expect(g.odds?.p7.family).toBeUndefined();
    const html = await render(Labs, { d, now: new Date(NOW) });
    const card = (id: string) =>
      html.slice(html.indexOf(`id="lab-${id}"`), html.indexOf('</article>', html.indexOf(`id="lab-${id}"`)));
    expect(card('google')).toMatch(
      /<dt[^>]*>30D<\/dt><dd[^>]*>.*<span class="rfam"[^>]*> · Gemini 4\.0<\/span>/,
    );
    expect(card('google')).toMatch(/title="Gemini 4\.0: /);
    expect(card('google')).not.toMatch(/<dt[^>]*>7D<\/dt><dd[^>]*>[^\n]*?rfam[^\n]*?<dt[^>]*>30D/);
    // Extrapolated: "~" and the extrap class (muted in CSS, never dimmed by opacity).
    expect(card('xai')).toMatch(/class="metric-value glow-y extrap"[^>]*>~\d+%</);
  });

  it('keeps the compact-card parts separable: the phone layout hides tempo, histogram, handles and market link', async () => {
    const html = await render(Labs, { d: dashboard() });
    const anthropic = html.slice(
      html.indexOf('id="lab-anthropic"'),
      html.indexOf('</article>', html.indexOf('id="lab-anthropic"')),
    );
    for (const part of [
      'metric-label tempo',
      'class="hist"',
      'class="x"',
      'class="mkt"',
      'class="reads"',
      'class="latest"',
    ])
      expect(anthropic).toContain(part);
  });
});

describe('Signals rows and pills', () => {
  it('derives each panel pill from its sources and shows one-line track records', async () => {
    const d = dashboard();
    const html = await render(Signals, { d, now: NOW });
    // YouTube, the leak sources and the registry did not report in this dashboard: not LIVE. The
    // pill is the shared `sourcePill`, so it names what answered and turns STALE on an open page.
    expect(html).toMatch(
      /<span class="pill warn" title="OpenRouter: ok · HN leaks: no result · TestingCatalog: no result · YouTube broadcasts: no result · transformers registry: no result" data-source-pill data-stale-at="2026-09-26T12:15:00.000Z" data-stale-text="STALE · 1\/5 SOURCES"[^>]*>PARTIAL · 1\/5 SOURCES</,
    );
    for (const line of [
      TRACK_LINES.stealth,
      TRACK_LINES.leaks,
      TRACK_LINES.broadcasts,
      TRACK_LINES.architectures,
    ])
      expect(html).toContain(line);
    expect(html).not.toContain('>LIVE<');
  });

  it('is LIVE only when every source answered, with per-subsection empty states', async () => {
    const base = dashboard();
    const d = {
      ...base,
      sources: base.sources.concat(
        [
          SOURCE.hnLeaks,
          SOURCE.testingCatalog,
          SOURCE.youtube,
          SOURCE.transformers,
          SOURCE.hnLaunches,
          SOURCE.openai,
          SOURCE.deepmind,
          SOURCE.anthropic,
          SOURCE.xai,
        ].map((name) => ({ name, ok: true })),
      ),
      earlyWarnings: { ...base.earlyWarnings, stealth: { ...base.earlyWarnings.stealth, items: [] } },
    };
    const html = await render(Signals, { d, now: NOW });
    expect(html.match(/class="pill live"[^>]*>LIVE · \d SOURCES</g)).toEqual([
      expect.stringContaining('>LIVE · 5 SOURCES<'),
      expect.stringContaining('>LIVE · 6 SOURCES<'),
    ]);
    expect(html).toContain('No anonymous slots on OpenRouter right now.');
    expect(html).toContain('No unlisted leaks in the last two weeks.');
    expect(html).toContain('No launch posts on the labs’ own feeds in the last 7 days.');
    expect(html).toContain('No release story over the points bar this week.');
  });

  it('lays every row out the same way, with its age in a cell that never wraps', async () => {
    const d = { ...dashboard(), earlyWarnings: warnings() };
    const html = await render(Signals, { d, now: NOW });
    const rows = html.match(/class="sig-row"/g) ?? [];
    const whens = html.match(/class="sig-when"/g) ?? [];
    expect(rows.length).toBeGreaterThan(4);
    expect(whens).toHaveLength(rows.length);
    expect(html).toMatch(/class="sig-when" data-time="2026-09-25T09:00:00Z"[^>]*>1d ago</);
    expect(html).toContain('in 5h');
    expect(html).toContain('31d pending');
  });

  it('counts only the labs\' own feeds as "FEED DOWN", and the launch search as HN', async () => {
    const base = dashboard();
    const withSources = (down: string[]) => ({
      ...base,
      sources: [SOURCE.hnLaunches, SOURCE.openai, SOURCE.deepmind, SOURCE.anthropic, SOURCE.xai].map(
        (name) => (down.includes(name) ? { name, ok: false, error: 'down' } : { name, ok: true }),
      ),
    });
    const announcements = (html: string) =>
      /LAB ANNOUNCEMENTS <span class="count"[^>]*>([^<]*)</.exec(html)?.[1];
    const stories = (html: string) =>
      /HACKER NEWS LAUNCH STORIES <span class="count"[^>]*>([^<]*)</.exec(html)?.[1];
    // HN's launch search down, every lab feed up: no feed is down.
    const hn = await render(Signals, { d: withSources([SOURCE.hnLaunches]), now: NOW });
    expect(announcements(hn)).toBe('0');
    expect(stories(hn)).toBe('HN DOWN');
    // One lab feed down: counted once.
    const one = await render(Signals, { d: withSources([SOURCE.deepmind]), now: NOW });
    expect(announcements(one)).toBe('0 · 1 FEED DOWN');
    expect(stories(one)).toBe('0');
  });

  it('says why a subsection is empty when its source is down', async () => {
    const d = dashboard(darkInputs);
    const html = await render(Signals, { d, now: NOW });
    expect(html).toContain('OpenRouter is unreachable, so stealth slots are unknown right now.');
    expect(html).toContain('OpenRouter is unreachable, so this week’s listings are unknown.');
    expect(html).toContain('The transformers registry is unreachable right now.');
  });
});
