/**
 * Launch banner.
 *
 * Sits at the top of every game page while `GAME_PAUSED` is set on Vercel.
 * It's a permanent, dismissable-looking strip rather than a modal — testers
 * can still poke around, save stables for the coming Saturday, join
 * leagues, all the usual — but the launch date reads at a glance whenever
 * they land on a game route.
 *
 * Copy is deliberately imperative and dateless-in-the-year: "Friday night
 * from 7pm" holds up week to week if we ever need to relaunch the same
 * signal later, and reads as immediate not distant.
 */

export function LaunchBanner() {
  return (
    <div
      className="flex items-center gap-3 rounded-[16px] bg-[linear-gradient(90deg,#04b56b,#12d17c)] px-4 py-2.5 shadow-[0_2px_8px_rgba(4,181,107,0.35)]"
      role="status"
    >
      <div
        aria-hidden
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/25 text-[16px]"
      >
        🏁
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/85">
          Launching
        </div>
        <div className="truncate text-[13.5px] font-extrabold uppercase leading-tight tracking-tight text-white">
          Friday night from 7pm · for Saturday&rsquo;s racing
        </div>
      </div>
    </div>
  );
}
