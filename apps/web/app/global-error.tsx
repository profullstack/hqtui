"use client";

/**
 * The last resort: an error in the root layout itself, where `error.tsx` cannot
 * help because the layout that renders it is the thing that failed. This one
 * must supply its own <html> and <body>.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en" className="dark">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#0a0a0a",
          color: "#e8edf2",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        <main style={{ padding: "2rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>hqtui.com is having a problem</h1>
          <p style={{ marginTop: "0.75rem", color: "#9aa4ad" }}>
            Please try again shortly.
            {error.digest ? ` (digest: ${error.digest})` : ""}
          </p>
        </main>
      </body>
    </html>
  );
}
