import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Script from "next/script";

const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

const description =
  "High Quality Terminal UI for TypeScript. btop-grade terminal dashboards with a one-import API, dark by default, zero runtime dependencies.";

export const metadata: Metadata = {
  metadataBase: new URL("https://hqtui.com"),
  title: {
    default: "HQTUI — High Quality Terminal UI for TypeScript",
    template: "%s — HQTUI",
  },
  description,
  keywords: [
    "tui", "terminal ui", "typescript", "bun", "node", "btop", "dashboard",
    "ansi", "braille", "truecolor", "framebuffer", "cli",
  ],
  authors: [{ name: "Profullstack, Inc.", url: "https://profullstack.com" }],
  openGraph: {
    type: "website",
    url: "https://hqtui.com",
    title: "HQTUI — High Quality Terminal UI for TypeScript",
    description,
    siteName: "HQTUI",
    images: [
      { url: "/shots/dashboard.png", width: 3302, height: 1709, alt: "HQTUI dashboard" },
    ],
  },
  appleWebApp: { title: "HQTUI", statusBarStyle: "black-translucent" },
  twitter: {
    card: "summary_large_image",
    title: "HQTUI — High Quality Terminal UI for TypeScript",
    description,
    images: ["/shots/dashboard.png"],
  },
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [
      { url: "/icons/apple-touch-icon-180x180.png", sizes: "180x180" },
      { url: "/icons/apple-touch-icon-152x152.png", sizes: "152x152" },
      { url: "/icons/apple-touch-icon-120x120.png", sizes: "120x120" },
    ],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable} antialiased`}>{children}        <Script data-site="78aa3a25-d804-46fc-b49e-28ffeb75861f" src="https://crawlproof.com/stats.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
