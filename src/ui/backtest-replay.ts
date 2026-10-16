/**
 * The /backtest v3 replay chart (`BacktestReplay.astro`): the 72-hour forecast and the best 7-day
 * read, hour by hour, over the fit and held-out windows, with each frontier launch marked, in a wide
 * and a narrow layout, plus its weekly table twin. Pure; every value comes from the committed replay
 * JSON and the forecast constants the page passes in.
 */
import type { Replay } from '../../scripts/backtest/replay';
import { pct } from '../../scripts/backtest/view';
import type { ForecastConstants } from '../domain/forecast';
import { labById, type LabId } from '../domain/lab';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** "2026-04-01" in UTC. */
export const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/** "1 Apr" in UTC. */
export const utcShortDate = (ms: number): string => new Date(ms).toUTCString().slice(5, 11).replace(/^0/, '');
/** "Apr" in UTC. */
export const utcMonth = (ms: number): string => new Date(ms).toUTCString().slice(8, 11);
/** A lab's display name, or its id when the registry has none. */
export const labName = (id: LabId): string => labById(id)?.name ?? id;
/** "anthropic/claude-opus-5.5" → "claude-opus-5.5". */
const modelName = (id: string) => id.replace(/^[^/]+\//, '');

/** One path per series in data units (x = sample index, y = 1000 − p·1000), drawn by both layouts. */
export function replayPath(values: readonly number[]): string {
  const ys = values.map((v) => Math.round(1000 - Math.min(1, Math.max(0, v)) * 1000));
  return `M0 1000V${ys[0]}${ys
    .slice(1)
    .map((y, i) => `l1 ${y - ys[i]}`)
    .join('')}V1000`;
}

const LAYOUTS = [
  { name: 'wide', W: 1200, left: 52, right: 150, top: 40, panel: 150, gap: 40, bottom: 30, inside: false },
  // A phone: a left margin wide enough for "100%", and the reference rates printed above each
  // panel rather than on its trace.
  { name: 'narrow', W: 340, left: 46, right: 10, top: 56, panel: 120, gap: 52, bottom: 28, inside: true },
];

export type ReplayInput = Pick<Replay, 'meta' | 'series' | 'releases' | 'pricedEvents'>;

/** Everything the component draws. */
export function replayView(replay: ReplayInput, constants: ForecastConstants) {
  const { series, meta } = replay;
  const t0 = Date.parse(series.from);
  const t1 = Date.parse(meta.window.until);
  const split = Date.parse(meta.split.at);
  const stepMs = series.stepH * HOUR_MS;
  const last = series.p.length - 1;
  const timeAt = (i: number) => t0 + i * stepMs;
  const horizon = (h: number) => constants.horizons.find((x) => x.horizonHours === h)!;
  const h72 = horizon(meta.headlineH);
  const h7d = horizon(168);
  /** "≥50%": the bar a launch's own-lab read had to reach to count as priced. */
  const pricedBar = `≥${pct(meta.protocol.pricedMin)}`;

  /** Each launch with whether its own lab's market read 50% or more in the 72 hours before it listed. */
  const priced = new Map(replay.pricedEvents.events.map((e) => [`${e.at}|${e.labId}`, e]));
  const launches = replay.releases.markers.map((m) => {
    const e = priced.get(`${m.at}|${m.labId}`);
    const t = Date.parse(m.at);
    const models = m.models.map(modelName);
    const shown =
      models.length > 2 ? `${models.slice(0, 2).join(', ')} +${models.length - 2}` : models.join(', ');
    return {
      t,
      held: t > split,
      priced: e?.priced ?? false,
      maxRead: e?.maxLabP72 ?? 0,
      shown,
      title: `${utcDay(t)} · ${labName(m.labId)} · ${shown}. Its own lab's ${meta.headlineH}-hour read peaked at ${pct(e?.maxLabP72 ?? 0)} in the ${meta.headlineH} hours before it listed${e?.priced ? ` (priced ${pricedBar})` : ` (not priced ${pricedBar})`}.`,
    };
  });
  const heldOut = launches.filter((l) => l.held);
  const heldPriced = heldOut.filter((l) => l.priced).length;

  /** The longest stretch where the 72h forecast held 90% or more and nothing frontier listed within 72 hours. */
  const listedWithin = (t: number, h: number) => launches.some((l) => l.t > t && l.t <= t + h * HOUR_MS);
  const falseAlarm = (() => {
    let best: { from: number; to: number } | null = null;
    let start = -1;
    series.p.forEach((p, i) => {
      const t = timeAt(i);
      const quiet = p >= 0.9 && t + meta.headlineH * HOUR_MS <= t1 && !listedWithin(t, meta.headlineH);
      if (!quiet) return void (start = -1);
      if (start < 0) start = i;
      if (!best || i - start > best.to - best.from) best = { from: start, to: i };
    });
    return best as { from: number; to: number } | null;
  })();
  const alarmDays = falseAlarm ? ((falseAlarm.to - falseAlarm.from) * series.stepH) / 24 : 0;

  const panels = [
    {
      id: 'p72',
      values: series.p,
      title: `NEXT ${meta.headlineH}H · FORECAST (d)`,
      fit: h72.baseRate,
      held: h72.test.rate,
    },
    {
      id: 'lead7',
      values: series.lead7,
      title: 'NEXT 7D · BEST LAB READ (P7)',
      fit: h7d.baseRate,
      held: h7d.test.rate,
    },
  ];
  const months = Array.from({ length: 12 }, (_, m) => Date.UTC(new Date(t0).getUTCFullYear(), m, 1)).filter(
    (t) => t >= t0 && t <= t1,
  );

  const views = LAYOUTS.map((l) => {
    const plotW = l.W - l.left - l.right;
    const x = (t: number) => l.left + ((t - t0) / (t1 - t0)) * plotW;
    const ps = panels.map((p, k) => {
      const top = l.top + 16 + k * (l.panel + l.gap);
      const y = (v: number) => top + (1 - v) * l.panel;
      return { ...p, top, y, bottom: top + l.panel };
    });
    const stripTop = ps[ps.length - 1].bottom + 8;
    // Launches within a marker's width of each other stack into lanes instead of hiding each other.
    const lanes: number[] = [];
    const marks = launches.map((m) => {
      const cx = x(m.t);
      let lane = lanes.findIndex((end) => cx - end > 10);
      if (lane < 0) lane = lanes.length;
      lanes[lane] = cx;
      return { ...m, cx, cy: stripTop + 8 + lane * 10 };
    });
    const strip = 14 + lanes.length * 10;
    const H = stripTop + strip + l.bottom;
    const scale = `translate(${l.left} 0) scale(${(plotW / last).toFixed(5)} 1)`;
    return { ...l, x, plotW, panels: ps, stripTop, strip, H, marks, scale, clipInset: (1.6 * last) / plotW };
  });

  const label = `Hourly replay from ${utcDay(t0)} to ${utcDay(t1)}, drawn every ${series.stepH} hours, of two market-only reads: the ${meta.headlineH}-hour forecast (formula d, noisy-OR) and the best 7-day read across labs, the shape of the level's main input. Fitted on ${utcDay(t0)} to ${utcDay(split)} (${constants.fittedOn.events} launches, a ${meta.headlineH}-hour rate of ${pct(h72.baseRate)}) and tested on ${utcDay(split)} to ${utcDay(t1)} (${constants.testedOn.events} launches, a rate of ${pct(h72.test.rate)}). Only ${heldPriced} of the ${heldOut.length} held-out launches had their own lab's market at ${pct(meta.protocol.pricedMin)} or more in the ${meta.headlineH} hours before.${falseAlarm ? ` The forecast held 90% or more for ${alarmDays.toFixed(1)} days from ${utcShortDate(timeAt(falseAlarm.from))} with nothing listed within 72 hours.` : ''} The table below has weekly values.`;

  /** The table twin: one row per week. */
  const weeks = (() => {
    const per = Math.round((7 * DAY_MS) / stepMs);
    const rows = [];
    for (let i = 0; i <= last; i += per) {
      const idx = Array.from({ length: Math.min(per, last + 1 - i) }, (_, k) => i + k);
      const from = timeAt(i);
      const to = Math.min(from + 7 * DAY_MS, t1);
      const p = idx.map((j) => series.p[j]);
      const lead = idx.map((j) => series.lead7[j]);
      const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
      rows.push({
        from,
        window: to <= split ? 'fit' : from >= split ? 'held out' : 'fit / held out',
        p: { mean: mean(p), min: Math.min(...p), max: Math.max(...p) },
        lead: mean(lead),
        launches: launches.filter((m) => m.t > from && m.t <= to),
      });
    }
    return rows;
  })();

  return {
    meta,
    t1,
    split,
    last,
    timeAt,
    h72,
    pricedBar,
    heldOut,
    heldPriced,
    falseAlarm,
    alarmDays,
    panels,
    months,
    views,
    label,
    weeks,
  };
}
