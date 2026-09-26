// @ts-ignore This app deliberately does not ship Node type declarations; these tests run in Node.
import { readdirSync, readFileSync } from 'node:fs';
// @ts-ignore This app deliberately does not ship Node type declarations; these tests run in Node.
import { DatabaseSync } from 'node:sqlite';
import type { D1Statement, SnapshotDatabase } from '../../src/infra/snapshot-store';

const MIGRATIONS_DIR = new URL('../../migrations/', import.meta.url);

/** Migration files in the order `wrangler d1 migrations apply` runs them. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name: string) => name.endsWith('.sql'))
    .sort();
}

/**
 * The real SQL engine behind a `SnapshotDatabase`: an in-memory SQLite with the repo's
 * migrations applied, so tests exercise the actual statements, triggers and JSON
 * functions rather than a JS re-implementation of them. D1 is SQLite; the one known
 * difference is that D1's `meta.changes` also counts trigger writes, which callers only
 * ever compare against zero.
 */
export class SqliteD1 implements SnapshotDatabase {
  readonly sqlite = new DatabaseSync(':memory:');
  readonly queries: string[] = [];

  constructor(migrations: readonly string[] = migrationFiles()) {
    for (const name of migrations) this.migrate(name);
  }

  migrate(name: string): void {
    this.sqlite.exec(readFileSync(new URL(name, MIGRATIONS_DIR), 'utf8'));
  }

  prepare(query: string): D1Statement {
    return this.statement(query, []);
  }

  private statement(query: string, values: unknown[]): D1Statement {
    return {
      bind: (...next: unknown[]) => this.statement(query, next),
      run: async () => {
        this.queries.push(query);
        const { changes } = this.sqlite.prepare(query).run(...values);
        return { meta: { changes: Number(changes) } };
      },
      first: async <T>() => {
        this.queries.push(query);
        return (this.sqlite.prepare(query).get(...values) ?? null) as T | null;
      },
      all: async <T>() => {
        this.queries.push(query);
        return { results: this.sqlite.prepare(query).all(...values) as T[] };
      },
    };
  }
}
