/**
 * A tiny Turso client over the HTTP pipeline API.
 *
 * The official @libsql/client drags in a websocket transport that Next's
 * standalone tracer does not follow, which breaks the deployed build. This
 * workload is a handful of short statements, so plain fetch is both smaller
 * and more reliable — and it keeps the site dependency-free like the library.
 */

/**
 * Next inlines `process.env.NAME` at build time, so a runtime secret read
 * through a literal key compiles in as undefined forever.
 */
function env(name: string): string | undefined {
  const key = name;
  return process.env[key];
}

type Value = string | number | null;

interface TursoValue {
  type: "null" | "integer" | "float" | "text" | "blob";
  value?: string | number;
}

function encode(value: Value): TursoValue {
  if (value === null || value === undefined) return { type: "null" };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { type: "integer", value: String(value) }
      : { type: "float", value };
  }
  return { type: "text", value: String(value) };
}

function decode(value: TursoValue | null): Value {
  if (!value || value.type === "null") return null;
  if (value.type === "integer") return Number(value.value);
  if (value.type === "float") return Number(value.value);
  return String(value.value ?? "");
}

export interface Row {
  [column: string]: Value;
}

function endpoint(): { url: string; token: string } | null {
  const raw = env("TURSO_DATABASE_URL");
  const token = env("TURSO_AUTH_TOKEN");
  if (!raw || !token) return null;
  const url = raw.replace(/^libsql:\/\//, "https://").replace(/\/$/, "");
  return { url: `${url}/v2/pipeline`, token };
}

export function configured(): boolean {
  return endpoint() !== null;
}

/** Run statements in one round trip. Returns one row set per statement. */
export async function execute(
  statements: (string | { sql: string; args: Value[] })[],
): Promise<Row[][]> {
  const target = endpoint();
  if (!target) return statements.map(() => []);

  const requests = statements.map((statement) => {
    const sql = typeof statement === "string" ? statement : statement.sql;
    const args = typeof statement === "string" ? [] : statement.args;
    return { type: "execute", stmt: { sql, args: args.map(encode) } };
  });
  requests.push({ type: "close" } as never);

  const response = await fetch(target.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${target.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ requests }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`turso: HTTP ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as {
    results: {
      type: string;
      error?: { message: string };
      response?: {
        result?: { cols: { name: string }[]; rows: TursoValue[][] };
      };
    }[];
  };

  return body.results.slice(0, statements.length).map((entry) => {
    if (entry.type === "error") throw new Error(`turso: ${entry.error?.message ?? "query failed"}`);
    const result = entry.response?.result;
    if (!result) return [];
    return result.rows.map((cells) => {
      const row: Row = {};
      result.cols.forEach((col, i) => {
        row[col.name] = decode(cells[i] ?? null);
      });
      return row;
    });
  });
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

export async function voteForTheme(theme: string): Promise<number> {
  if (!configured()) return 0;
  await migrate();
  const [, rows] = await execute([
    {
      sql: `INSERT INTO theme_votes (theme, votes) VALUES (?, 1)
            ON CONFLICT(theme) DO UPDATE SET votes = votes + 1, updated_at = datetime('now')`,
      args: [theme],
    },
    { sql: "SELECT votes FROM theme_votes WHERE theme = ?", args: [theme] },
  ]);
  return Number(rows[0]?.votes ?? 0);
}

export async function recordView(path: string): Promise<void> {
  if (!configured()) return;
  try {
    await migrate();
    await execute([
      {
        sql: `INSERT INTO page_views (path, views) VALUES (?, 1)
              ON CONFLICT(path) DO UPDATE SET views = views + 1, updated_at = datetime('now')`,
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
