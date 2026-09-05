import type { Metadata } from "next";
import "./globals.css";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "Horse Racing Tips — UK & Irish Racecards, Results and Tips",
    template: "%s | Horse Racing Tips",
  },
  description:
    "Racecards, results and tips for every UK and Irish meeting. Runners, riders, form, official ratings and going, updated through the day.",
  openGraph: { siteName: "Horse Racing Tips", locale: "en_GB", type: "website" },
};

/**
 * The document shell only — fonts and <body>. Site chrome lives in
 * app/(site)/layout.tsx so that /game can opt out of it entirely.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        {/*
          Antonio for headings, Inter for body, JetBrains Mono for anything
          numeric. The three families are named in app/globals.css; this is what
          actually fetches them. Preconnect first so the fonts are not queued
          behind the stylesheet round-trip.

          Plus Jakarta Sans is the game's face only, and never appears on the
          racecards. FPL's own typeface is a bespoke licensed one that cannot be
          obtained, so this is the closest free equivalent in feel: geometric,
          slightly rounded, with enough character to carry a headline.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Antonio:wght@400;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600;700&family=Plus+Jakarta+Sans:wght@500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
