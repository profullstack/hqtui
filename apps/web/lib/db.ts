/**
 * The site's database: theme votes, page views and cookbook sales in Postgres
 * (the shared cluster on dev2), reached through @profullstack/libsql-pg. It
 * keeps the small `execute(statements)` shape the rest of this module was
 * written against for Turso's HTTP pipeline: a list of statements in one
 * round trip, one row set per statement. The SQL below is still SQLite's
 * (`datetime('now')`, `INSERT ... ON CONFLICT`); the client rewrites it per
 * statement, and the CREATE TABLEs go through its schema converter.
 */
import { createClient, type Client } from "@profullstack/libsql-pg";

/**
 * Next inlines `process.env.NAME` at build time, so a runtime secret read
 * through a literal key compiles in as undefined forever.
 */
function env(name: string): string | undefined {
  const key = name;
  return process.env[key];
}

type Value = string | number | null;

export interface Row {
  [column: string]: Value;
}

let client: Client | null = null;

/** The Postgres URL, or null when the site runs without a database (it renders regardless). */
function databaseUrl(): string | null {
  const url = env("DATABASE_URL");
  if (!url) return null;
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    // Turso (libsql://) is no longer read: the data moved to Postgres in 2026-09.
    console.error(`hqtui: DATABASE_URL must be a postgres:// URL, got "${url.split(":")[0]}:"; running without a database`);
    return null;
  }
  return url;
}

export function configured(): boolean {
  return databaseUrl() !== null;
}

function db(): Client | null {
  if (client) return client;
  const url = databaseUrl();
  if (!url) return null;
  client = createClient({ url, pool: { max: 3 } });
  return client;
}

/**
 * Run statements in one round trip (one transaction). Returns one row set per statement.
 *
 * Upserts below qualify the column they increment (`page_views.views + 1`):
 * inside ON CONFLICT DO UPDATE Postgres reads a bare `views` as ambiguous
 * between the row and EXCLUDED; SQLite accepts the qualified form too.
 */
export async function execute(
  statements: (string | { sql: string; args: Value[] })[],
): Promise<Row[][]> {
  const target = db();
  if (!target) return statements.map(() => []);
  const results = await target.batch(statements, "write");
  return results.map((rs) =>
    rs.rows.map((row) => {
      const out: Row = {};
      for (const column of rs.columns) out[column] = (row[column] as Value) ?? null;
      return out;
    }),
  );
}

let ready: Promise<void> | null = null;

/** Create tables on first use. Idempotent, so it is safe on every cold start. */
export async function migrate(): Promise<void> {
  if (!configured()) return;
  if (!ready) {
    ready = execute([
      `CREATE TABLE IF NOT EXISTS theme_votes (
         theme TEXT PRIMARY KEY,
         votes INTEGER NOT NULL DEFAULT 0,
         updated_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
      `CREATE TABLE IF NOT EXISTS page_views (
         path TEXT PRIMARY KEY,
         views INTEGER NOT NULL DEFAULT 0,
         updated_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
      // Cookbook PDF sales. The row exists from the moment checkout starts, so
      // an abandoned payment is distinguishable from one that never happened.
      `CREATE TABLE IF NOT EXISTS book_purchases (
         payment_id TEXT PRIMARY KEY,
         chain TEXT NOT NULL,
         status TEXT NOT NULL DEFAULT 'pending',
         downloads INTEGER NOT NULL DEFAULT 0,
         created_at TEXT NOT NULL DEFAULT (datetime('now')),
         paid_at TEXT
       )`,
    ]).then(() => undefined).catch((error) => {
      // An unreachable database must never take the marketing site down.
      console.error("hqtui: migration failed", error);
      ready = null;
    });
  }
  await ready;
}

export interface ThemeVote {
  theme: string;
  votes: number;
}

export async function themeVotes(): Promise<ThemeVote[]> {
  if (!configured()) return [];
  try {
    await migrate();
    const [rows] = await execute([
      "SELECT theme, votes FROM theme_votes ORDER BY votes DESC, theme ASC",
    ]);
    return rows.map((row) => ({ theme: String(row.theme), votes: Number(row.votes) }));
  } catch (error) {
    console.error("hqtui: themeVotes failed", error);
    return [];
  }
}

export async function voteForTheme(theme: string): Promise<number | null> {
  if (!configured()) return 0;
  try {
    await migrate();
    const [, rows] = await execute([
      {
        sql: `INSERT INTO theme_votes (theme, votes) VALUES (?, 1)
              ON CONFLICT(theme) DO UPDATE SET votes = theme_votes.votes + 1, updated_at = datetime('now')`,
        args: [theme],
      },
      { sql: "SELECT votes FROM theme_votes WHERE theme = ?", args: [theme] },
    ]);
    return Number(rows[0]?.votes ?? 0);
  } catch (error) {
    // The same rule the rest of this module follows: an unreachable database
    // must never take the site down. Null distinguishes "not recorded" from a
    // genuine zero, so the caller can answer honestly.
    console.error("hqtui: voteForTheme failed", error);
    return null;
  }
}

export async function recordView(path: string): Promise<void> {
  if (!configured()) return;
  try {
    await migrate();
    await execute([
      {
        sql: `INSERT INTO page_views (path, views) VALUES (?, 1)
              ON CONFLICT(path) DO UPDATE SET views = page_views.views + 1, updated_at = datetime('now')`,
        args: [path],
      },
    ]);
  } catch (error) {
    console.error("hqtui: recordView failed", error);
  }
}

export async function totalViews(): Promise<number> {
  if (!configured()) return 0;
  try {
    await migrate();
    const [rows] = await execute(["SELECT COALESCE(SUM(views), 0) AS total FROM page_views"]);
    return Number(rows[0]?.total ?? 0);
  } catch {
    return 0;
  }
}

// --- Cookbook sales ---------------------------------------------------------

export async function recordCheckout(paymentId: string, chain: string): Promise<void> {
  if (!configured()) return;
  try {
    await migrate();
    await execute([
      {
        sql: `INSERT INTO book_purchases (payment_id, chain) VALUES (?, ?)
              ON CONFLICT(payment_id) DO NOTHING`,
        args: [paymentId, chain],
      },
    ]);
  } catch (error) {
    // A sale that cannot be recorded must still be completable: the webhook
    // will insert the row when it confirms.
    console.error("hqtui: could not record checkout", error);
  }
}

export async function markPaid(paymentId: string): Promise<void> {
  if (!configured()) return;
  await migrate();
  await execute([
    {
      sql: `INSERT INTO book_purchases (payment_id, chain, status, paid_at)
            VALUES (?, 'unknown', 'paid', datetime('now'))
            ON CONFLICT(payment_id) DO UPDATE SET status = 'paid', paid_at = datetime('now')`,
      args: [paymentId],
    },
  ]);
}

/** True when the payment confirmed. Counts the download on the way past. */
export async function claimDownload(paymentId: string): Promise<boolean> {
  if (!configured()) return false;
  await migrate();
  const [rows] = await execute([
    {
      sql: `SELECT status FROM book_purchases WHERE payment_id = ?`,
      args: [paymentId],
    },
  ]);
  if (rows?.[0]?.status !== "paid") return false;
  await execute([
    {
      sql: `UPDATE book_purchases SET downloads = downloads + 1 WHERE payment_id = ?`,
      args: [paymentId],
    },
  ]);
  return true;
}
