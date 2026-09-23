#!/usr/bin/env node
import { captureSnapshot, usage } from './dashboard-archive.mjs';

function options(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--allow-stale') result.allowStale = true;
    else if (['--dir', '--url', '--max-age-minutes'].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
      const key = arg.slice(2).replaceAll('-', '_');
      if (key in result) throw new Error(`duplicate option: ${arg}`);
      result[key] = value;
    } else throw new Error(`unknown or incomplete option: ${arg}`);
  }
  return result;
}

if (process.argv.slice(2).includes('--help')) console.log(usage('capture'));
else {
  try {
    const args = options(process.argv.slice(2));
    const { path, envelope } = await captureSnapshot({
      directory: args.dir,
      url: args.url,
      maxAgeMinutes: args.max_age_minutes === undefined ? 15 : Number(args.max_age_minutes),
      allowStale: args.allowStale,
    });
    console.log(
      JSON.stringify(
        {
          path,
          fetchedAt: envelope.fetchedAt,
          responseSha256: envelope.responseSha256,
          quality: envelope.quality,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(`capture failed: ${error.message}`);
    process.exitCode = 1;
  }
}
