/**
 * `pnpm backtest` regenerates data/backtest/*.json from the cached raw pulls in
 * data/backtest/raw. `pnpm backtest --refresh` re-pulls raw first (Gamma, CLOB, HN Algolia,
 * OpenRouter; about 750 requests). Output is deterministic for a given raw set.
 */
// @ts-ignore This app deliberately does not ship Node type declarations; this script runs in Node.
import { execFileSync } from 'node:child_process';
// @ts-ignore This app deliberately does not ship Node type declarations; this script runs in Node.
import { mkdir, writeFile } from 'node:fs/promises';
import { buildBacktest } from './build';
import { RELEASES } from './curated';
import { fetchHn, fetchOpenRouter, fetchReleaseEvents, fetchSeries } from './fetch';
import { OUT_DIR as OUT, RAW_DIR as RAW, readRaw } from './io';

const argv = (globalThis as { process?: { argv?: string[] } }).process?.argv ?? [];

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function refresh(): Promise<void> {
  const pulledAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  await mkdir(RAW, { recursive: true });
  console.log('gamma: closed ai events + open ai-releases events');
  const events = await fetchReleaseEvents(new Set(RELEASES.flatMap((r) => r.markets)));
  console.log(`gamma: ${events.length} release events; clob: pulling price histories`);
  const series = await fetchSeries(events);
  console.log(`clob: ${Object.keys(series).length} series; hn + openrouter`);
  const hn = await fetchHn(RELEASES.map((r) => ({ id: r.id, ...r.hn })));
  const openrouter = await fetchOpenRouter();
  await writeJson(`${RAW}/gamma-events.json`, events);
  await writeJson(`${RAW}/clob-series.json`, series);
  await writeJson(`${RAW}/hn.json`, hn);
  await writeJson(`${RAW}/openrouter-models.json`, openrouter);
  await writeJson(`${RAW}/pulled.json`, { pulledAt });
}

async function main(): Promise<void> {
  if (argv.includes('--refresh')) await refresh();
  const outputs = buildBacktest(await readRaw());
  const written: string[] = [];
  for (const [name, value] of Object.entries(outputs)) {
    await writeJson(`${OUT}/${name}.json`, value);
    written.push(`${OUT}/${name}.json`);
  }
  // Committed JSON must pass `pnpm lint`, so format it the way oxfmt would.
  execFileSync('pnpm', ['exec', 'oxfmt', RAW, ...written], { stdio: 'inherit' });
  console.log(`wrote ${written.join(', ')}`);
}

await main();
