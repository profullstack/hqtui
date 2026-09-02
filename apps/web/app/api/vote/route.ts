import { NextResponse } from "next/server";
import { themeVotes, voteForTheme } from "@/lib/db";
import { themes } from "@profullstack/hqtui";

const VALID = new Set(Object.values(themes).map((theme) => theme.name));

export async function GET() {
  return NextResponse.json({ votes: await themeVotes() });
}

export async function POST(request: Request) {
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
