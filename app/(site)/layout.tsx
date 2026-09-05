import Link from "next/link";

/**
 * The site chrome — claret bar, nav, responsible-gambling footer.
 *
 * This lives in a route group rather than the root layout because the game at
 * /game is its own visual world and must not inherit it. A route group changes
 * no URLs: /, /racecards and every race page resolve exactly as before, which
 * matters because those are indexed and a moved URL costs the page.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-rule bg-[var(--claret)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="font-display text-[24px] text-[var(--brass-light)]">
            Horse Racing Tips
          </Link>
          <nav className="flex gap-4 text-[13px] text-[var(--brass-light)]">
            <Link href="/racecards" className="hover:underline underline-offset-4">
              Racecards
            </Link>
            <Link href="/game" className="hover:underline underline-offset-4">
              Fantasy
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
    </>
  );
}
