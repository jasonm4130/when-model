#!/usr/bin/env node
import { evaluateSnapshots, readArchive, readReleaseEvents, usage } from './dashboard-archive.mjs';
import { writeFile } from 'node:fs/promises';

function options(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (['--archive', '--releases', '--out'].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`missing value for ${arg}`);
      const key = arg.slice(2);
      if (key in result) throw new Error(`duplicate option: ${arg}`);
      result[key] = value;
    } else throw new Error(`unknown or incomplete option: ${arg}`);
  }
  return result;
}

if (process.argv.slice(2).includes('--help')) console.log(usage('evaluate'));
else {
  try {
    const args = options(process.argv.slice(2));
    if (!args.archive || !args.releases) throw new Error('--archive and --releases are required');
    const report = {
      format: 'whenmodel-dashboard-evaluation/v1',
      generatedAt: new Date().toISOString(),
      archive: args.archive,
      releases: evaluateSnapshots(await readArchive(args.archive), await readReleaseEvents(args.releases)),
    };
    const text = `${JSON.stringify(report, null, 2)}\n`;
    if (args.out) await writeFile(args.out, text, { encoding: 'utf8', flag: 'wx' });
    else process.stdout.write(text);
  } catch (error) {
    console.error(`evaluation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
