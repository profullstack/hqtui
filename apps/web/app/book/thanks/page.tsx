import Link from "next/link";

import { SiteFooter, SiteNav } from "@/components/site/nav";
import { BOOK_TITLE } from "@/lib/book";
import { sessionPaid, signDownloadToken } from "@/lib/coinpay";
import { markPaid, purchaseStatus } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata = {
  title: `Thanks | ${BOOK_TITLE}`,
  robots: { index: false, follow: false },
};

type Search = { searchParams: Promise<{ session?: string }> };

const SESSION_ID = /^cs_[A-Za-z0-9]{8,64}$/;

/**
 * Where CoinPay sends the buyer after paying. The session id in the URL is the
 * purchase key. Paid (by webhook, or by asking CoinPay with the business key
 * when the buyer is back first) shows the download link; otherwise the page
 * refreshes itself until the payment confirms.
 */
export default async function Thanks({ searchParams }: Search) {
  const { session } = await searchParams;
  const key = session && SESSION_ID.test(session) ? session : null;

  let paid = false;
  if (key) {
    const status = await purchaseStatus(key);
    if (status === "paid") paid = true;
    else if (status === "pending" && (await sessionPaid(key))) {
      const result = await markPaid(key, false);
      paid = result === "paid" || result === "already_paid";
    }
  }

  return (
    <div className="min-h-screen bg-[#05070a] text-white">
      {key && !paid ? <meta httpEquiv="refresh" content="10" /> : null}
      <SiteNav />
      <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-10 sm:px-6">
        <Link href="/book" className="font-mono text-xs text-white/50 hover:text-white">
          ← {BOOK_TITLE}
        </Link>
        {!key ? (
          <>
            <h1 className="mt-6 text-3xl font-bold tracking-tight">Nothing to show here</h1>
            <p className="mt-3 text-white/60">
              This page opens after a checkout.{" "}
              <Link href="/book/buy" className="text-[#5fff87] underline underline-offset-4">
                Get the PDF
              </Link>
              .
            </p>
          </>
        ) : paid ? (
          <>
            <h1 className="mt-6 text-3xl font-bold tracking-tight">Thank you. It is yours.</h1>
            <p className="mt-3 text-white/60">The link works for 48 hours. Keep this page or the file.</p>
            <a
              href={`/api/book/download?token=${signDownloadToken(key)}`}
              className="mt-6 inline-block rounded-lg bg-[#5fff87] px-4 py-2.5 font-medium text-black transition-opacity hover:opacity-90"
            >
              Download the PDF
            </a>
          </>
        ) : (
          <>
            <h1 className="mt-6 text-3xl font-bold tracking-tight">Waiting for the payment to confirm</h1>
            <p className="mt-3 text-white/60">
              This page checks again every few seconds. Crypto can take a minute or two to confirm; PayPal
              is usually instant. If it does not arrive,{" "}
              <a href="mailto:hello@profullstack.com" className="text-white/80 underline underline-offset-4">
                email us
              </a>{" "}
              with the checkout id <code className="font-mono text-white/80">{key}</code>.
            </p>
          </>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
