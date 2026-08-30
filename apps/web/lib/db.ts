import { createClient, type Client } from "@libsql/client";

/**
 * Next inlines `process.env.NAME` at build time, so runtime secrets have to be
 * read through a non-literal key or they compile in as undefined forever.
 */
function env(name: string): string | undefined {
  const key = name;
  return process.env[key];
}

let client: Client | null = null;
let ready: Promise<void> | null = null;

export function db(): Client | null {
  const url = env("TURSO_DATABASE_URL");
  if (!url) return null;
  if (!client) {
    client = createClient({ url, authToken: env("TURSO_AUTH_TOKEN") });
  }
  return client;
}

/** Create tables on first use. Idempotent, so it is safe on every cold start. */
export async function migrate(): Promise<void> {
  const connection = db();
  if (!connection) return;
  if (!ready) {
    ready = (async () => {
      await connection.batch([
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
      ], "write");
    })().catch((error) => {
      // A missing database must never take the marketing site down.
      console.error("hqtui: database migration failed", error);
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
  const connection = db();
  if (!connection) return [];
  try {
    await migrate();
    const result = await connection.execute("SELECT theme, votes FROM theme_votes ORDER BY votes DESC, theme ASC");
    return result.rows.map((row) => ({ theme: String(row.theme), votes: Number(row.votes) }));
  } catch (error) {
    console.error("hqtui: themeVotes failed", error);
    return [];
  }
}

export async function voteForTheme(theme: string): Promise<number> {
  const connection = db();
  if (!connection) return 0;
  await migrate();
  await connection.execute({
    sql: `INSERT INTO theme_votes (theme, votes) VALUES (?, 1)
          ON CONFLICT(theme) DO UPDATE SET votes = votes + 1, updated_at = datetime('now')`,
    args: [theme],
  });
  const result = await connection.execute({
    sql: "SELECT votes FROM theme_votes WHERE theme = ?",
    args: [theme],
  });
  return Number(result.rows[0]?.votes ?? 0);
}

export async function recordView(path: string): Promise<void> {
  const connection = db();
  if (!connection) return;
  try {
    await migrate();
    await connection.execute({
      sql: `INSERT INTO page_views (path, views) VALUES (?, 1)
            ON CONFLICT(path) DO UPDATE SET views = views + 1, updated_at = datetime('now')`,
      args: [path],
    });
  } catch (error) {
    console.error("hqtui: recordView failed", error);
  }
}

export async function totalViews(): Promise<number> {
  const connection = db();
  if (!connection) return 0;
  try {
    await migrate();
    const result = await connection.execute("SELECT COALESCE(SUM(views), 0) AS total FROM page_views");
    return Number(result.rows[0]?.total ?? 0);
  } catch {
    return 0;
  }
}
