import Link from "next/link";

import { SiteFooter, SiteNav } from "@/components/site/nav";
import { allChapters, BOOK_TITLE } from "@/lib/book";
import { configured, PRICE_USD } from "@/lib/coinpay";
import { recordView } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = {
  title: `Get the PDF — ${BOOK_TITLE}`,
  description: `The typeset PDF of ${BOOK_TITLE}, one dollar, paid in crypto or PayPal.`,
};

type Search = { searchParams: Promise<{ error?: string; cancelled?: string }> };

export default async function Buy({ searchParams }: Search) {
  await recordView("/book/buy");
  const { error, cancelled } = await searchParams;
  const chapters = allChapters();

  return (
    <div className="min-h-screen bg-[#05070a] text-white">
      <SiteNav />
      <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-10 sm:px-6">
        <Link href="/book" className="font-mono text-xs text-white/50 hover:text-white">
          ← {BOOK_TITLE}
        </Link>

        <h1 className="mt-6 text-3xl font-bold tracking-tight">The PDF, ${PRICE_USD}</h1>
        <p className="mt-3 leading-relaxed text-white/60">
          {chapters.length} chapters, typeset, yours to keep. The same book is free to read{" "}
          <Link href="/book" className="text-[#5fff87] underline underline-offset-4">
            on this site
          </Link>{" "}
          and free as an{" "}
          <a href="/book.epub" className="text-[#5fff87] underline underline-offset-4">
            EPUB
          </a>
          , and nothing in the PDF is missing from either. A dollar is for the typesetting and for
          keeping the lights on.
        </p>

        {error ? (
          <p className="mt-6 rounded-lg border border-[#ff5555]/40 bg-[#ff5555]/10 px-4 py-3 text-sm text-[#ffb3b3]">
            {error === "email"
              ? "Enter an email address so CoinPay can send your receipt."
              : "That did not start. Nothing was charged. Try again in a minute."}
          </p>
        ) : null}
        {cancelled && !error ? (
          <p className="mt-6 rounded-lg border border-white/15 px-4 py-3 text-sm text-white/60">
            Checkout cancelled. Nothing was charged.
          </p>
        ) : null}

        {configured() ? (
          <form action="/api/book/checkout" method="post" className="mt-8">
            <label htmlFor="email" className="block text-sm text-white/70">
              Email for your receipt
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="mt-2 w-full rounded-lg border border-white/15 bg-[#0a0e14] px-3 py-2 text-white"
            />
            <p className="mt-2 text-[13px] text-white/40">
              On the next page you pay with USDC, USDT, BTC, ETH, SOL and more, or PayPal.
            </p>

            <button
              type="submit"
              className="mt-5 w-full rounded-lg bg-[#5fff87] px-4 py-2.5 font-medium text-black transition-opacity hover:opacity-90"
            >
              Continue to CoinPay
            </button>
          </form>
        ) : (
          <p className="mt-8 rounded-lg border border-white/15 px-4 py-3 text-sm text-white/60">
            Checkout is not configured on this deployment. The book is still free to
            read on the site and as an EPUB.
          </p>
        )}

        <h2 className="mt-12 text-lg font-bold">How it works</h2>
        <ol className="mt-3 space-y-2 text-sm leading-relaxed text-white/60">
          <li>1. On CoinPay you pick a coin (or PayPal) and pay one dollar.</li>
          <li>2. CoinPay tells us when it confirms and brings you back here.</li>
          <li>
            3. You get a download link that works for 48 hours. Lost it? Pay nothing again, just{" "}
            <a href="mailto:hello@profullstack.com" className="text-white/80 underline underline-offset-4">
              email us
            </a>{" "}
            the checkout id.
          </li>
        </ol>
        <p className="mt-4 text-[13px] text-white/40">
          No account and no card. The email is only for your receipt. We never see a wallet key, and
          the payment settles to us directly rather than sitting in an escrow.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
