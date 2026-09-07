import Link from "next/link";

import { SiteFooter, SiteNav } from "@/components/site/nav";
import { allChapters, BOOK_TITLE } from "@/lib/book";
import { CHAINS, configured, DEFAULT_CHAIN, PRICE_USD } from "@/lib/coinpay";
import { recordView } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = {
  title: `Get the PDF — ${BOOK_TITLE}`,
  description: `The typeset PDF of ${BOOK_TITLE}, one dollar, paid in crypto.`,
};

type Search = { searchParams: Promise<{ error?: string }> };

export default async function Buy({ searchParams }: Search) {
  await recordView("/book/buy");
  const { error } = await searchParams;
  const chapters = allChapters();
  const stablecoins = CHAINS.filter((chain) => chain.group === "Stablecoin");
  const coins = CHAINS.filter((chain) => chain.group === "Coin");

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
            That did not start. Nothing was charged. Try again, or pick another chain.
          </p>
        ) : null}

        {configured() ? (
          <form action="/api/book/checkout" method="post" className="mt-8">
            <label htmlFor="chain" className="block text-sm text-white/70">
              Pay with
            </label>
            <select
              id="chain"
              name="chain"
              defaultValue={DEFAULT_CHAIN}
              className="mt-2 w-full rounded-lg border border-white/15 bg-[#0a0e14] px-3 py-2 text-white"
            >
              <optgroup label="Stablecoins">
                {stablecoins.map((chain) => (
                  <option key={chain.code} value={chain.code}>
                    {chain.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Coins">
                {coins.map((chain) => (
                  <option key={chain.code} value={chain.code}>
                    {chain.label}
                  </option>
                ))}
              </optgroup>
            </select>
            <p className="mt-2 text-[13px] text-white/40">
              Fifteen chains. USDC on Solana is the default because a network fee should not cost
              more than the book.
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
            Card and crypto checkout is not configured on this deployment. The book is still free to
            read on the site and as an EPUB.
          </p>
        )}

        <h2 className="mt-12 text-lg font-bold">How it works</h2>
        <ol className="mt-3 space-y-2 text-sm leading-relaxed text-white/60">
          <li>1. You pick a chain and CoinPay shows you an address and an amount.</li>
          <li>2. You pay it. CoinPay tells us when it confirms.</li>
          <li>
            3. You get a download link that works for 48 hours. Lost it? Pay nothing again, just{" "}
            <a href="mailto:hello@profullstack.com" className="text-white/80 underline underline-offset-4">
              email us
            </a>{" "}
            the payment id.
          </li>
        </ol>
        <p className="mt-4 text-[13px] text-white/40">
          No account, no email required, no card. We never see a wallet key, and the payment settles
          to us directly rather than sitting in an escrow.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
