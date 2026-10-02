import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import DropconScope from '../../src/components/DropconScope.astro';
import LabDetail from '../../src/components/LabDetail.astro';
import Labs from '../../src/components/Labs.astro';
import ScoreDetail from '../../src/components/ScoreDetail.astro';
import ServiceStatus from '../../src/components/ServiceStatus.astro';
import Signals from '../../src/components/Signals.astro';
import Layout from '../../src/layouts/Layout.astro';
import { assembleDashboard, type Dashboard, type DashboardInputs } from '../../src/domain/dashboard';
import type { Drop } from '../../src/domain/drop';
import { buildInstrument } from '../../src/domain/instrument';
import type { Market } from '../../src/domain/market';
import { SOURCE } from '../../src/domain/sources';
import { dropconTitle } from '../../src/ui/odds';
import { labPage } from '../../src/ui/lab-page';
import { lineBullet } from '../../src/ui/lines';
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

describe('DropconScope: service history, the week of the level', () => {
  const d = dashboard();

  it('renders an intentional empty state, with the live level still at the NOW edge', async () => {
    const html = await render(DropconScope, { d, history: { ok: true, points: [] }, now: NOW });
    expect(html).toMatch(
      /class="sc-plot" data-plot role="img" aria-label="DROPCON history, the lead score over the last 7 days/,
    );
    expect(html).toContain('NO READINGS YET');
    expect(html).toContain('v3 history starts 26 Sep: the 15-minute capture writes the first point.');
    expect(html).not.toContain('class="sc-line"');
    // The live level still sits at the NOW edge; the posted number is the service status's, not the chart's.
    expect(html).not.toContain('data-num');
    expect(html).toMatch(new RegExp(`class="sc-nowtag tiny"[^>]*>NOW <b[^>]*>${d.dropcon.level}</b>`));
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
    // The NOW tag is the live reading all the same.
    expect(html).toMatch(new RegExp(`class="sc-nowtag tiny"[^>]*>NOW <b[^>]*>${d.dropcon.level}</b>`));
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
      /data-r-near[^>]*>1 frontier launch in 7 days · latest A Claude Opus 5\.5 \(Anthropic\), 22 Sep</,
    );
    expect(scopeData(html).launches).toHaveLength(d.landed.releases.length);
    // Each launch carries its line's bullet: the letter in the readout and on the flag, in the line's colour.
    const b = lineBullet('anthropic');
    expect(scopeData(html).launches[0].slice(3)).toEqual([b.letter, b.fill]);
    expect(html).toMatch(
      new RegExp(`class="sc-flag[^"]*"[^>]*><i style="--c:${b.fill};--fg:${b.ink}"[^>]*>A</i>`),
    );
  });

  it('says the launch listings are offline instead of drawing a week with no launches', async () => {
    const down = dashboard({ drops: { name: SOURCE.openrouter, data: [], ok: false, error: 'down' } });
    const html = await render(DropconScope, { d: down, history: { ok: true, points: series(v3) }, now: NOW });
    expect(html).toContain('LAUNCH LISTINGS OFFLINE');
    expect(html).toContain('Launch listings offline: OpenRouter unreachable, launches not marked');
    expect(scopeData(html).launchesOk).toBe(false);
  });

  it('leaves the score-to-level rule to the service status, which prints it for a reading only', async () => {
    const html = await render(DropconScope, { d, history: { ok: true, points: [] }, now: NOW });
    expect(html).not.toContain('sc-eq');
    const status = await render(ServiceStatus, { c: d.dropcon });
    expect(status).toMatch(
      new RegExp(
        `Level <b class="ss-num"[^>]*data-num[^>]*>${d.dropcon.level}</b> of 5 · lead score <b class="mono"[^>]*>${d.dropcon.score}</b>/100`,
      ),
    );
    for (const inputs of [floorInputs, darkInputs]) {
      const off = await render(ServiceStatus, { c: dashboard(inputs).dropcon });
      expect(off).not.toContain('lead score');
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

describe('DROPCON for a first-time reader', () => {
  it('on /about, adds the score up row by row, says plainly it is no forecast and lists the bands', async () => {
    const d = dashboard();
    const html = await render(ScoreDetail, { d });
    const at = (s: string) => html.indexOf(s);
    expect(at('dc-now')).toBeLessThan(at('dc-drivers'));
    expect(html.match(/class="tag lead"[^>]*>LEAD</g)).toHaveLength(d.dropcon.provenance.length);
    const pts = [...html.matchAll(/<span class="pts"[^>]*>(\d+)<\/span>/g)].map((m) => Number(m[1]));
    expect(pts.slice(0, -1).reduce((a, b) => a + b, 0)).toBe(pts.at(-1));
    expect(html).toMatch(/<h2 id="forecast-title"[^>]*>Is this a forecast\?<\/h2>/);
    expect(html).toMatch(
      /<b[^>]*>No\.<\/b> It's a hand-weighted lead score, not a probability\. <a href="\/backtest"/,
    );
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
  });

  it('posts the level above the week, explains the chart plainly and links to how it adds up', async () => {
    const d = dashboard();
    const status = await render(ServiceStatus, { c: d.dropcon });
    expect(status).toContain('href="/about#score"');
    expect(status).toMatch(/<h2 id="status-title"[^>]*>/);
    const html = await render(DropconScope, { d, history: { ok: true, points: [] }, now: NOW });
    // The arithmetic is one link away on /about, not on the home page.
    expect(html).not.toContain('dc-drivers');
    expect(html).toContain('href="/about#score"');
    // What the reader is looking at, long and short, and what it is not.
    expect(html).toContain(
      "The line is DROPCON's lead score, 0 to 100, read hourly from Polymarket's release odds",
    );
    expect(html).toContain('The line is the 0–100 lead score; its band sets the level, 5 quiet to 1 surge.');
    expect(html).toContain('A lead score, not a forecast.');
    expect(html).toContain("a line's launch, first listed on OpenRouter: context, not scored");
    expect(html.indexOf('dc-scale')).toBeLessThan(html.indexOf('dc-what'));
    // The network keeps each line's old anchor id for old links.
    expect(await render(Labs, { d })).toContain(`id="lab-${d.labs[0].id}"`);
  });

  it('shows a floor as a signal failure, with dimmed segments and no lit level', async () => {
    const d = dashboard(floorInputs);
    expect(d.dropcon.state).toBe('floor');
    const status = await render(ServiceStatus, { c: d.dropcon });
    expect(status).toContain('SIGNAL FAILURE');
    expect(status).toMatch(/data-num[^>]*>5</);
    expect(status).toContain('class="ss is-offline"');
    expect(status).toContain('aria-label="DROPCON floor: 5 of 5 with the odds offline"');
    const html = await render(DropconScope, { d, now: NOW });
    expect(html).toContain('class="sc-dot"');
    expect(html).toMatch(/data-r-what[^>]*>floor · odds offline, not measured</);
    expect(html).not.toMatch(/class="seg on/);
    expect(html.match(/class="seg dim/g)).toHaveLength(5);
    expect(html).toContain('class="seg dim floor l5"');
    expect(html).toContain('aria-label="DROPCON floor: 5 of 5 with the odds offline"');
    expect(dropconTitle(d.dropcon)).toBe('DROPCON 5 · FLOOR (odds offline) — whenmodel');
    // Every line says its odds are offline, never "no timetable".
    const labs = await render(Labs, { d });
    expect(labs).toContain('odds offline');
    expect(labs).not.toContain('no timetable');
  });

  it('shows "?" and NO SIGNAL with every segment dimmed, and titles the page DROPCON — NO SIGNAL', async () => {
    const d = dashboard(darkInputs);
    const status = await render(ServiceStatus, { c: d.dropcon });
    expect(status).toMatch(/data-num[^>]*>\?</);
    expect(status).toContain('NO SIGNAL');
    const html = await render(DropconScope, { d, now: NOW });
    expect(html).not.toContain('class="sc-dot');
    expect(html).not.toContain('class="sc-nowtag');
    expect(html).toMatch(/data-r-what[^>]*>no signal · odds and listings down</);
    expect(html.match(/class="seg dim l\d"/g)).toHaveLength(5);
    const page = await container.renderToString(Layout, {
      props: { title: dropconTitle(d.dropcon), description: 'd' },
      slots: { default: '<p>x</p>' },
    });
    expect(page).toContain('<title>DROPCON — NO SIGNAL — whenmodel</title>');
  });
});

describe('The network and a line page', () => {
  it('flags each line with the lead signals that name it, linked to the early warnings', async () => {
    const d = { ...dashboard(), earlyWarnings: warnings() };
    const html = await render(Labs, { d });
    const row = (id: string) =>
      html.slice(html.indexOf(`id="lab-${id}"`), html.indexOf('</li>', html.indexOf(`id="lab-${id}"`)));
    expect(row('openai')).toMatch(/class="flag" href="\/radar#ew-leaks"[^>]*>LEAK ×2</);
    expect(row('openai')).toMatch(/class="flag" href="\/radar#ew-streams"[^>]*>STREAM 5H</);
    expect(row('openai')).toMatch(/class="flag" href="\/radar#ew-events"[^>]*>KEYNOTE 70H</);
    expect(row('qwen')).toMatch(/class="flag" href="\/radar#ew-arch"[^>]*>ARCH</);
    expect(row('anthropic')).not.toContain('class="flag');
    // A stealth slot has no line: it is counted once, under the list, never on a row.
    expect(html).toContain('1 unmarked train on the network');
  });

  it("names how a line's 7-day read was taken, and gives its tempo a text alternative", async () => {
    const d = dashboard();
    const html = await render(LabDetail, { d, p: labPage(d, 'anthropic')!, now: new Date(NOW) });
    // Sonnet's only rung is Sep 30: 7 days is past it and held there, a floor.
    expect(html).toContain('At least: held at its 30 Sep stop.');
    expect(html).toMatch(
      /class="hist" role="img" aria-label="Models listed on OpenRouter per month: Oct 2025 \d+, [^"]*Sep 2026 \d+\."/,
    );
    // The strip map: now, the Sep 30 stop, and the 72-hour tick between them.
    expect(html).toMatch(
      /<ol class="strip"[^>]*aria-label="Timetable for Next Claude Sonnet: chance it has shipped by each stop"/,
    );
    expect(html).toMatch(/class="d"[^>]*>Wed 30 Sep</);
    expect(html).toMatch(/class="d"[^>]*>72 hours</);
    const net = await render(Labs, { d });
    expect(net).toMatch(
      /class="lrow"[^>]*href="\/labs\/anthropic"[\s\S]*?<h3 class="lab-name"[^>]*>Anthropic line<\/h3>/,
    );
  });

  it('says "no timetable" only when the odds are up, and counts arrivals per 30 days', async () => {
    const html = await render(Labs, { d: dashboard() });
    expect(html).toContain('no timetable');
    expect(html).not.toContain('odds offline');
    const anthropic = html.slice(
      html.indexOf('id="lab-anthropic"'),
      html.indexOf('</li>', html.indexOf('id="lab-anthropic"')),
    );
    expect(anthropic).toMatch(/ · 1\/30d</);
  });

  it("never prints an extrapolated read on the network, and keeps another family off the line's strip", async () => {
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
    const html = await render(Labs, { d });
    const row = (id: string) =>
      html.slice(html.indexOf(`id="lab-${id}"`), html.indexOf('</li>', html.indexOf(`id="lab-${id}"`)));
    expect(row('xai')).toContain('times unavailable');
    expect(row('xai')).not.toMatch(/\d+%/);
    // Google's 30-day read is Gemini 4.0's: its strip shows no 30-day tick; Gemini 4.0 is another service.
    const page = await render(LabDetail, { d, p: labPage(d, 'google')!, now: new Date(NOW) });
    expect(page).not.toMatch(/class="d"[^>]*>30 days</);
    expect(page).toMatch(
      /class="sn"[^>]*>Gemini 4\.0<\/span><span class="sp mono"[^>]*>79%<\/span><span class="sw mono"[^>]*>by 31 Oct</,
    );
    // A line on a thin market says so on its own page, and keeps the extrapolated read small.
    const xai = await render(LabDetail, { d, p: labPage(d, 'xai')!, now: new Date(NOW) });
    expect(xai).toMatch(/class="big none-word"[^>]*>Times unavailable</);
    expect(xai).toContain('Extrapolated, not scored: ~');
  });

  it('lists every line as one row, in heat order, each with its own bullet', async () => {
    const d = dashboard();
    const html = await render(Labs, { d });
    const ids = [...html.matchAll(/<li class="line"[^>]*id="lab-([a-z]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(d.labs.map((l) => l.id));
    for (const lab of d.labs) {
      const b = lineBullet(lab.id);
      expect(html).toMatch(
        new RegExp(`id="lab-${lab.id}"[\\s\\S]*?style="--c:${b.fill};--fg:${b.ink}"[^>]*>${b.letter}<`),
      );
    }
    // No folds: a row is one line of facts and a link to the line's page.
    expect(html).not.toContain('<details');
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
      /Lab announcements <span class="count"[^>]*>([^<]*)</.exec(html)?.[1];
    const stories = (html: string) =>
      /Hacker News launch stories <span class="count"[^>]*>([^<]*)</.exec(html)?.[1];
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
