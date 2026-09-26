/**
 * File access for the backtest: reading the committed raw pulls. Split from run.ts so tests can
 * load the raw set without running the pipeline.
 */
// @ts-ignore This app deliberately does not ship Node type declarations; this script runs in Node.
import { readFile } from 'node:fs/promises';
import type { RawPulls } from './build';

export const RAW_DIR = 'data/backtest/raw';
export const OUT_DIR = 'data/backtest';

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export async function readRaw(dir = RAW_DIR): Promise<RawPulls> {
  return {
    pulledAt: (await readJson<{ pulledAt: string }>(`${dir}/pulled.json`)).pulledAt,
    events: await readJson(`${dir}/gamma-events.json`),
    series: await readJson(`${dir}/clob-series.json`),
    hn: await readJson(`${dir}/hn.json`),
    openrouter: await readJson(`${dir}/openrouter-models.json`),
  };
}
