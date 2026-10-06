import { NextResponse } from "next/server";
import { ping } from "@/lib/db";

// A cached answer reports the cache's health, not the app's.
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

/** Public health check for status.profullstack.com. Never says why the database is down. */
export async function GET() {
  if (!(await ping())) {
    return NextResponse.json({ status: "error", db: "down" }, { status: 503, headers });
  }
  return NextResponse.json({ status: "ok", db: "ok" }, { headers });
}
