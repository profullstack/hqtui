import { NextResponse } from "next/server";
import { themeVotes, voteForTheme } from "@/lib/db";
import { clientKey, rateLimited } from "@/lib/rate-limit";
import { themes } from "@profullstack/hqtui";

const VALID = new Set(Object.values(themes).map((theme) => theme.name));

/** Reads are cheaper than writes but still reach Turso, so they are bounded too. */
const READS_PER_MINUTE = 60;

export async function GET(request: Request) {
  if (rateLimited(`get:${clientKey(request)}`, READS_PER_MINUTE)) {
    return NextResponse.json({ error: "too many requests" }, { status: 429 });
  }
  return NextResponse.json({ votes: await themeVotes() });
}

/** Votes allowed per client per minute. Generous for a person, useless for a loop. */
const VOTES_PER_MINUTE = 10;

export async function POST(request: Request) {
  // The counter is displayed publicly, so what is worth protecting is the
  // number's meaning as much as the database behind it.
  if (rateLimited(clientKey(request), VOTES_PER_MINUTE)) {
    return NextResponse.json({ error: "too many votes" }, { status: 429 });
  }
  let theme: unknown;
  try {
    ({ theme } = await request.json());
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (typeof theme !== "string" || !VALID.has(theme)) {
    return NextResponse.json({ error: "unknown theme" }, { status: 400 });
  }
  const votes = await voteForTheme(theme);
  if (votes === null) {
    return NextResponse.json({ error: "vote not recorded" }, { status: 503 });
  }
  return NextResponse.json({ theme, votes });
}
