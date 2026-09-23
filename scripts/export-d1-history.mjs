#!/usr/bin/env node
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeEnvelope } from './dashboard-archive.mjs';

// Input is the JSON output of a read-only `wrangler d1 execute ... --json` query.
const [input, directory, ...extra] = process.argv.slice(2);
if (input === '--help') {
  console.log('Usage: node scripts/export-d1-history.mjs <wrangler-export.json> <archive-directory>');
} else {
  try {
    if (!input || !directory || extra.length) throw new Error('expected input JSON and output directory');
    const queries = JSON.parse(await readFile(input, 'utf8'));
    if (!Array.isArray(queries) || queries.some((q) => q.success !== true || !Array.isArray(q.results))) {
      throw new Error('expected successful Wrangler query results');
    }
    await mkdir(directory, { recursive: true });
    let count = 0;
    for (const row of queries.flatMap((q) => q.results)) {
      if (
        typeof row.observed_at !== 'string' ||
        typeof row.scheduled_slot !== 'string' ||
        typeof row.payload_json !== 'string'
      ) {
        throw new Error('export row is missing original observation metadata');
      }
      const envelope = makeEnvelope({
        response: JSON.parse(row.payload_json),
        responseText: row.payload_json,
        fetchedAt: row.observed_at,
        url: `d1://whenmodel-history/dashboard_snapshots/${row.scheduled_slot}`,
      });
      envelope.scheduledSlot = row.scheduled_slot;
      envelope.exportedAt = new Date().toISOString();
      envelope.quality.notes.push('compact D1 observation; export time is not observation time');
      const name = `${envelope.fetchedAt.replace(/[:.]/g, '-')}-${envelope.responseSha256.slice(0, 12)}.json`;
      await writeFile(join(directory, name), `${JSON.stringify(envelope, null, 2)}\n`, { flag: 'wx' });
      count++;
    }
    console.log(JSON.stringify({ exported: count, directory }));
  } catch (error) {
    console.error(`D1 export failed: ${error.message}`);
    process.exitCode = 1;
  }
}
