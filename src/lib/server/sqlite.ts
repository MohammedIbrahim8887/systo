/** One synchronous SQLite API over bun:sqlite (desktop) and node:sqlite (web dev on Node). */

export type SqlValue = string | number | null;

export interface Db {
  exec(sql: string): void;
  run(sql: string, params?: SqlValue[]): void;
  all<T>(sql: string, params?: SqlValue[]): T[];
  transaction(fn: () => void): void;
  close(): void;
}

interface Statement {
  run(...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
}

interface Driver {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

async function load(path: string): Promise<Driver> {
  // Joined so bundlers leave runtime-only modules alone.
  if ((globalThis as { Bun?: unknown }).Bun) {
    const { Database } = (await import(/* @vite-ignore */ ["bun", "sqlite"].join(":"))) as {
      Database: new (path: string, options?: { create?: boolean }) => Driver;
    };
    return new Database(path, { create: true });
  }
  const { DatabaseSync } = (await import(/* @vite-ignore */ ["node", "sqlite"].join(":"))) as {
    DatabaseSync: new (path: string) => Driver;
  };
  return new DatabaseSync(path);
}

export async function openDb(path: string): Promise<Db> {
  const driver = await load(path);
  const cache = new Map<string, Statement>();
  const statement = (sql: string) => {
    let s = cache.get(sql);
    if (!s) cache.set(sql, (s = driver.prepare(sql)));
    return s;
  };
  return {
    exec: (sql) => driver.exec(sql),
    run: (sql, params = []) => void statement(sql).run(...params),
    all: <T>(sql: string, params: SqlValue[] = []) => statement(sql).all(...params) as T[],
    transaction(fn) {
      driver.exec("BEGIN");
      try {
        fn();
        driver.exec("COMMIT");
      } catch (error) {
        driver.exec("ROLLBACK");
        throw error;
      }
    },
    close: () => driver.close(),
  };
}
