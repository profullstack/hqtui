import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/** lucide dropped brand icons in v1, so the mark lives here. */
function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="mr-1 h-4 w-4 fill-current">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

const LINKS = [
  { href: "/#features", label: "Features" },
  { href: "/showcase", label: "Showcase" },
  { href: "/docs", label: "Docs" },
  { href: "/blog", label: "Blog" },
  { href: "/#themes", label: "Themes" },
  { href: "/#performance", label: "Performance" },
];

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-background/80 backdrop-blur-xl">
      <nav className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
        {/* The square mark here, the full logo in the hero: at nav size the
            logo's tagline strip is unreadable, and showing the same artwork
            twice on one screen reads as a mistake. */}
        <Link href="/" className="shrink-0" aria-label="HQTUI home">
          <Image
            src="/icons/icon-512x512.png"
            alt="HQTUI"
            width={512}
            height={512}
            priority
            className="h-8 w-8"
          />
        </Link>
        <div className="hidden items-center gap-5 text-sm text-white/60 md:flex">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="transition-colors hover:text-white">
              {link.label}
            </Link>
          ))}
          {/* A plain anchor, not next/link: the board is a separate origin on
              its own subdomain, so there is no route for the router to
              prefetch and nothing it could do with one. */}
          <a href="https://bbs.hqtui.com" className="transition-colors hover:text-white">
            Discussions
          </a>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            render={
              <a
                href="https://www.npmjs.com/package/@profullstack/hqtui"
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            npm
          </Button>
          <Button
            size="sm"
            variant="secondary"
            render={
              <a href="https://github.com/profullstack/hqtui" target="_blank" rel="noreferrer" />
            }
          >
            <GithubMark />
            GitHub
          </Button>
        </div>
      </nav>
    </header>
  );
}

export function SiteFooter({ views }: { views?: number }) {
  return (
    <footer className="border-t border-white/10 py-10">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 text-sm text-white/50 sm:flex-row sm:items-center sm:px-6">
        <div className="flex items-center gap-2 font-mono">
          <Image src="/icons/icon-512x512.png" alt="HQTUI" width={512} height={512} className="h-4 w-4 opacity-70" />
          <span className="text-white/50">·</span>
          <span>MIT</span>
        </div>
        <div className="flex flex-wrap gap-4 sm:ml-auto">
          <a className="hover:text-white" href="https://bbs.hqtui.com">Discussions</a>
          <a className="hover:text-white" href="https://github.com/profullstack/hqtui">GitHub</a>
          <a className="hover:text-white" href="https://www.npmjs.com/package/@profullstack/hqtui">npm</a>
          <Link className="hover:text-white" href="/docs">Docs</Link>
          <Link className="hover:text-white" href="/blog">Blog</Link>
          <a className="hover:text-white" href="https://github.com/profullstack/hqtui/blob/main/docs/PRD.md">PRD</a>
        </div>
        {views ? <span className="font-mono text-xs text-white/50">{views.toLocaleString()} views</span> : null}
      </div>
    </footer>
  );
}
