"use client";

import { useEffect } from "react";
import Link from "next/link";
import { SiteNav } from "@/components/site/nav";

/**
 * Without this, any error thrown while rendering — most likely an unreachable
 * database — replaces the site with Next's unstyled framework page.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("hqtui: render failed", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <main className="mx-auto flex max-w-2xl flex-col items-start px-4 py-24 sm:px-6">
        <p className="font-mono text-sm text-white/50">something went wrong</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">This page did not render</h1>
        <p className="mt-4 text-white/60">
          The library itself is unaffected — this is the website. Try again, or read the docs.
        </p>
        {error.digest ? (
          <p className="mt-4 font-mono text-xs text-white/50">digest: {error.digest}</p>
        ) : null}
        <div className="mt-8 flex gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5"
          >
            Try again
          </button>
          <Link
            href="/docs"
            className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5"
          >
            Docs
          </Link>
        </div>
      </main>
    </div>
  );
}
