import type { Metadata } from "next";
import Link from "next/link";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        {/*
          Antonio for headings, Inter for body, JetBrains Mono for anything
          numeric. The three families are named in app/globals.css; this is what
          actually fetches them. Preconnect first so the fonts are not queued
          behind the stylesheet round-trip.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Antonio:wght@400;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">
        <header className="border-b border-rule bg-[var(--claret)]">
          <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-display text-[24px] text-[var(--brass-light)]">
              Horse Racing Tips
            </Link>
            <nav className="flex gap-4 text-[13px] text-[var(--brass-light)]">
              <Link href="/racecards" className="hover:underline underline-offset-4">
                Racecards
              </Link>
            </nav>
          </div>
        </header>

        {children}

        <footer className="mt-16 border-t border-rule py-8">
          <div className="mx-auto max-w-5xl px-4 text-[12px] text-muted">
            <p>
              18+. Please gamble responsibly.{" "}
              <a
                href="https://www.begambleaware.org"
                rel="noopener noreferrer nofollow"
                target="_blank"
                className="underline underline-offset-2"
              >
                BeGambleAware.org
              </a>
            </p>
            <p className="mt-2">
              Racing data updates through the day. Non-runners and going changes are reflected as
              they are published.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
