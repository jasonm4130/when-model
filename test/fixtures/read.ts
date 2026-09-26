// @ts-ignore This app deliberately does not ship Node type declarations; these tests run in Node.
import { readFileSync } from 'node:fs';

/** A raw upstream capture from this directory. */
export function fixture(name: string): string {
  return readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
}
