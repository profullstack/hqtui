import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

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
    images: [{ url: "/hqtui-dashboard.png", width: 1672, height: 941, alt: "HQTUI dashboard" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "HQTUI — High Quality Terminal UI for TypeScript",
    description,
    images: ["/hqtui-dashboard.png"],
  },
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body className={`${sans.variable} ${mono.variable} antialiased`}>{children}</body>
    </html>
  );
}
