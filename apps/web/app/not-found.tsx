import Link from "next/link";
import { SiteNav } from "@/components/site/nav";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <main className="mx-auto flex max-w-2xl flex-col items-start px-4 py-24 sm:px-6">
        <p className="font-mono text-sm text-white/50">404</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">No such page</h1>
        <p className="mt-4 text-white/60">
          The link may be out of date. Everything lives off the home page or the docs.
        </p>
        <div className="mt-8 flex gap-3">
          <Link
            href="/"
            className="rounded-lg border border-white/15 px-4 py-2 text-sm hover:bg-white/5"
          >
            Home
          </Link>
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
