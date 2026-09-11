"use client";

/**
 * Horse and jockey selection.
 *
 * Modelled closely on Fantasy Premier League's player-selection screen, and
 * deliberately so: eleven million people already know how to use that screen,
 * and a punter who recognises the shape of it does not have to be taught
 * anything. Search, sort, a bank bar, a row per pick, a plus to add.
 *
 * The one rule that has to read clearly is "one horse per race" — it is this
 * game's version of FPL's three-per-club, and it is the constraint players will
 * bump into most. So a horse in a race you have already used is greyed with the
 * reason stated in a banner, rather than silently refusing the tap.
 */

import { useMemo, useState } from "react";
import type { GameJockey, PricedRunner } from "@/lib/game-card";
import { JockeySilk } from "@/components/game/jockey-silk";

type Sort = "price-desc" | "price-asc" | "odds" | "name";

const SORTS: { value: Sort; label: string }[] = [
  { value: "price-desc", label: "Price: high to low" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "odds", label: "Shortest odds" },
  { value: "name", label: "Name A–Z" },
];

const CEILINGS = [0, 30, 20, 15, 10, 7, 5];
const money = (m: number) => `£${m.toFixed(1)}m`;

export type SelectionPanelProps = {
  runners: (PricedRunner & { course: string; offTime: string })[];
  jockeys: GameJockey[];
  horseIds: string[];
  jockeyIds: string[];
  takenRaces: Map<string, string>;
  bank: number;
  locked: boolean;
  canAffordHorse: (h: PricedRunner) => boolean;
  canAffordJockey: (j: GameJockey) => boolean;
  horsesFull: boolean;
  jockeysFull: boolean;
  onToggleHorse: (h: PricedRunner) => void;
  onToggleJockey: (j: GameJockey) => void;
  onAutoPick: () => void;
  notice: string | null;
};

export function SelectionPanel(props: SelectionPanelProps) {
  const [tab, setTab] = useState<"horses" | "jockeys">("horses");
  // 'list' is the flat search-and-scroll view; 'races' groups the same horses
  // by course and race so a player can browse by meeting when they know what
  // race they want but not which horse. Only meaningful on the Horses tab.
  const [horseMode, setHorseMode] = useState<"list" | "races">("list");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("price-desc");
  const [ceiling, setCeiling] = useState(0);

  // The list of course names on the game card — used in the empty-search hint
  // so a player searching for a horse at a track that isn't in the game (e.g.
  // Newcastle) can immediately see why it's not showing.
  const courseNames = useMemo(
    () => [...new Set(props.runners.map((r) => r.course))],
    [props.runners]
  );

  const reset = () => {
    setQuery("");
    setSort("price-desc");
    setCeiling(0);
  };

  const horses = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let list = props.runners.filter((h) => {
      if (ceiling && h.price > ceiling) return false;
      if (!needle) return true;
      return (
        h.horse.toLowerCase().includes(needle) ||
        h.course.toLowerCase().includes(needle) ||
        (h.jockey ?? "").toLowerCase().includes(needle)
      );
    });
    list = [...list].sort((a, b) => {
      if (sort === "price-asc") return a.price - b.price;
      if (sort === "odds") return a.oddsDec - b.oddsDec;
      if (sort === "name") return a.horse.localeCompare(b.horse);
      return b.price - a.price;
    });
    return list;
  }, [props.runners, query, sort, ceiling]);

  const jockeys = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let list = props.jockeys.filter((j) => {
      if (ceiling && j.price > ceiling) return false;
      return !needle || j.name.toLowerCase().includes(needle);
    });
    list = [...list].sort((a, b) => {
      if (sort === "price-asc") return a.price - b.price;
      if (sort === "name") return a.name.localeCompare(b.name);
      return b.price - a.price;
    });
    return list;
  }, [props.jockeys, query, sort, ceiling]);

  return (
    <section className="pt-1">
      <div className="mb-3 flex gap-1 rounded-xl bg-[#eef2f6] p-1">
        <TabButton active={tab === "horses"} onClick={() => setTab("horses")}>
          Horses
        </TabButton>
        <TabButton active={tab === "jockeys"} onClick={() => setTab("jockeys")}>
          Jockeys
        </TabButton>
      </div>

      {/* Sub-toggle for horses only: flat list (search + filter) vs racecards
          (browse by meeting → race → runner). Racecards mode is closer to how
          people actually think about their picks — "who do I like in the St
          Leger" — while the list stays for "give me all £8m or under". */}
      {tab === "horses" && (
        <div className="mb-4 flex gap-1 rounded-xl bg-[#f6f4f8] p-1">
          <SubTabButton
            active={horseMode === "list"}
            onClick={() => setHorseMode("list")}
          >
            Search list
          </SubTabButton>
          <SubTabButton
            active={horseMode === "races"}
            onClick={() => setHorseMode("races")}
          >
            Racecards
          </SubTabButton>
        </div>
      )}

      {/* Racecards mode has its own layout (course pills, race chips, then
          runners) so it doesn't need the flat search/sort chrome. Skip the
          search bar and filter pills here in that mode. */}
      {!(tab === "horses" && horseMode === "races") && (
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--slate)]"
            width="18"
            height="18"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden
          >
            <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="2" />
            <path d="m13 13 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            id="picker-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
            className="w-full rounded-xl border-2 border-[#e1e6ec] py-3 pl-11 pr-3 text-[15px] text-[var(--slate)] outline-none placeholder:text-[#a6b4bd] focus:border-[var(--pl-purple)]"
          />
        </div>
      )}

      {!(tab === "horses" && horseMode === "races") && (
      <div className="mt-3 flex flex-wrap gap-2">
        <Pill>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="bg-transparent pr-1 outline-none"
            aria-label="Sort"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Pill>
        <Pill>
          <select
            value={ceiling}
            onChange={(e) => setCeiling(Number(e.target.value))}
            className="bg-transparent pr-1 outline-none"
            aria-label="Maximum price"
          >
            {CEILINGS.map((c) => (
              <option key={c} value={c}>
                {c === 0 ? "Any price" : `£${c}m or less`}
              </option>
            ))}
          </select>
        </Pill>
        <button
          type="button"
          onClick={reset}
          className="flex items-center gap-1.5 rounded-full border-2 border-[#eef2f6] px-4 py-2 text-[13px] font-semibold text-[var(--slate)]"
        >
          Reset
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      )}

      <div className="mt-3 rounded-lg bg-[linear-gradient(90deg,#1adc86,#04b56b)] py-2.5 text-center text-[16px] font-extrabold text-white">
        Bank {money(props.bank)}
      </div>

      {props.notice && (
        <p className="mt-3 rounded-lg bg-[#e64545] px-4 py-2.5 text-center text-[14px] font-semibold text-white">
          {props.notice}
        </p>
      )}

      <div className="mt-4 flex items-end justify-between px-1">
        <h3 className="text-[19px] font-extrabold text-[var(--slate)]">
          {tab === "horses" ? `${horses.length} horses` : `${jockeys.length} jockeys`}
        </h3>
        <div className="flex gap-6 text-[13px] font-semibold text-[var(--slate-soft)]">
          <span>{tab === "horses" ? "Odds" : "Rides"}</span>
          <span className="w-14 text-right">Price</span>
        </div>
      </div>

      {tab === "horses" && horseMode === "races" ? (
        <RacecardsView
          runners={props.runners}
          horseIds={props.horseIds}
          takenRaces={props.takenRaces}
          horsesFull={props.horsesFull}
          locked={props.locked}
          canAffordHorse={props.canAffordHorse}
          onToggleHorse={props.onToggleHorse}
        />
      ) : (
      <div className="mt-1 max-h-[520px] overflow-y-auto">
        {tab === "horses"
          ? horses.map((h) => {
              const picked = props.horseIds.includes(h.horseId);
              const clashWith = props.takenRaces.get(h.raceId);
              const blocked =
                !picked &&
                (!!clashWith || props.horsesFull || !props.canAffordHorse(h) || props.locked);
              return (
                <Row
                  key={h.horseId}
                  picked={picked}
                  blocked={blocked}
                  onClick={() => props.onToggleHorse(h)}
                  art={
                    h.silkUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={h.silkUrl} alt="" width={40} height={40} className="h-9 w-9 object-contain" />
                    ) : (
                      <div className="h-9 w-9 rounded bg-[#efe9f1]" />
                    )
                  }
                  name={h.horse}
                  meta={`${h.course} ${h.offTime}`}
                  price={money(h.price)}
                  stat={h.frac}
                />
              );
            })
          : jockeys.map((j) => {
              const picked = props.jockeyIds.includes(j.id);
              const blocked =
                !picked && (props.jockeysFull || !props.canAffordJockey(j) || props.locked);
              return (
                <Row
                  key={j.id}
                  picked={picked}
                  blocked={blocked}
                  onClick={() => props.onToggleJockey(j)}
                  art={<JockeySilk id={j.id} size={36} />}
                  name={j.name}
                  meta={`${j.rides} ${j.rides === 1 ? "ride" : "rides"} on the card`}
                  price={money(j.price)}
                  stat={String(j.rides)}
                />
              );
            })}

        {(tab === "horses" ? horses : jockeys).length === 0 && (
          <div className="py-8 text-center">
            <p className="text-[14px] font-semibold text-[var(--slate)]">
              No match on this card.
            </p>
            {tab === "horses" && (
              <p className="mx-auto mt-2 max-w-[300px] text-[12.5px] leading-relaxed text-[var(--slate-soft)]">
                The game runs on the {courseNames.length} featured meetings:{" "}
                <strong className="text-[var(--slate)]">{courseNames.join(", ")}</strong>. Horses at
                other tracks are not in this week’s pool.
              </p>
            )}
          </div>
        )}
      </div>
      )}

      {tab === "horses" && horseMode === "list" && (
        <button
          type="button"
          onClick={props.onAutoPick}
          disabled={props.locked}
          className="mt-4 w-full rounded-xl bg-[linear-gradient(180deg,#1adc86,#04b56b)] py-3 text-[15px] font-extrabold text-white shadow-[0_2px_6px_rgba(4,181,107,0.35)] disabled:opacity-40 disabled:shadow-none"
        >
          Auto Pick
        </button>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------- parts */

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg py-2 text-[14px] font-extrabold transition-colors ${
        active
          ? "bg-white text-[var(--slate)] shadow-sm"
          : "text-[var(--slate)] hover:bg-white/70"
      }`}
    >
      {children}
    </button>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center rounded-full border-2 border-[#eef2f6] px-4 py-2 text-[13px] font-semibold text-[var(--slate)]">
      {children}
    </span>
  );
}

function Row({
  picked,
  blocked,
  onClick,
  art,
  name,
  meta,
  price,
  stat,
}: {
  picked: boolean;
  blocked: boolean;
  onClick: () => void;
  art: React.ReactNode;
  name: string;
  meta: string;
  price: string;
  stat: string;
}) {
  return (
    <div
      className={`flex items-center gap-3 border-b border-[#eef2f6] py-2.5 ${
        blocked ? "opacity-40" : ""
      }`}
    >
      <span className="w-3 shrink-0 text-center text-[15px] font-bold italic text-[var(--slate)]">
        i
      </span>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center">{art}</span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold leading-tight text-[var(--slate)]">
          {name}
        </span>
        <span className="block truncate text-[12.5px] text-[var(--slate-soft)]">{meta}</span>
      </span>

      <span className="num w-10 shrink-0 border-l border-[#eef2f6] pl-2 text-right text-[13.5px] font-semibold text-[var(--slate-soft)]">
        {stat}
      </span>
      <span className="num w-[60px] shrink-0 text-right text-[14.5px] font-bold text-[var(--slate)]">
        {price}
      </span>

      <button
        type="button"
        onClick={onClick}
        disabled={blocked && !picked}
        aria-label={picked ? `Remove ${name}` : `Add ${name}`}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[17px] font-bold ${
          picked
            ? "bg-[#e64545] text-white"
            : "bg-[#eef2f6] text-[var(--slate)] disabled:cursor-not-allowed"
        }`}
      >
        {picked ? "×" : "+"}
      </button>
    </div>
  );
}

/* ---------------------------------------------------- racecards view */

/**
 * Race-by-race browser. Course pills at the top; tapping one expands its
 * races underneath, one open at a time. Each race shows a mini-card with
 * every runner in that race — silks, name, jockey, odds, price — that a
 * player can tap to pick. Blocked runners (over budget, already picked
 * that race elsewhere, card locked) are dimmed with a tooltip on hover.
 */
function RacecardsView({
  runners,
  horseIds,
  takenRaces,
  horsesFull,
  locked,
  canAffordHorse,
  onToggleHorse,
}: {
  runners: (PricedRunner & { course: string; offTime: string })[];
  horseIds: string[];
  takenRaces: Map<string, string>;
  horsesFull: boolean;
  locked: boolean;
  canAffordHorse: (h: PricedRunner) => boolean;
  onToggleHorse: (h: PricedRunner) => void;
}) {
  // Group runners by (course, raceId). Order courses by earliest off, then
  // races by off time inside a course. Deterministic so navigating back to
  // the same view lands in the same place.
  const grouped = useMemo(() => {
    const byRace = new Map<
      string,
      { raceId: string; course: string; offTime: string; runners: typeof runners }
    >();
    for (const r of runners) {
      const bucket = byRace.get(r.raceId);
      if (bucket) bucket.runners.push(r);
      else byRace.set(r.raceId, { raceId: r.raceId, course: r.course, offTime: r.offTime, runners: [r] });
    }
    const races = [...byRace.values()].sort((a, b) => a.offTime.localeCompare(b.offTime));
    const byCourse = new Map<string, typeof races>();
    for (const r of races) {
      const arr = byCourse.get(r.course) ?? [];
      arr.push(r);
      byCourse.set(r.course, arr);
    }
    return [...byCourse.entries()].map(([course, races]) => ({ course, races }));
  }, [runners]);

  const [courseTab, setCourseTab] = useState(grouped[0]?.course ?? "");
  const [openRace, setOpenRace] = useState<string | null>(grouped[0]?.races[0]?.raceId ?? null);

  const activeCourse = grouped.find((g) => g.course === courseTab) ?? grouped[0];

  return (
    <div className="mt-2">
      {/* Course pills — horizontal scroll on narrow so 4 meetings fit even
          on the smallest phone. */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto pb-1 pt-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {grouped.map((g) => (
          <button
            key={g.course}
            type="button"
            onClick={() => {
              setCourseTab(g.course);
              setOpenRace(g.races[0]?.raceId ?? null);
            }}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-bold transition-colors ${
              courseTab === g.course
                ? "bg-[var(--slate)] text-white"
                : "bg-[#f2edf4] text-[var(--slate)]"
            }`}
          >
            {g.course}
            <span className="ml-1.5 text-[11px] opacity-70">{g.races.length}</span>
          </button>
        ))}
      </div>

      {/* Race list for the active course — each race is a card with a head
          (time + name + off-time deadline) and, when open, a body listing
          every runner in that race. */}
      <div className="mt-3 flex max-h-[520px] flex-col gap-2 overflow-y-auto pb-1">
        {activeCourse?.races.map((race) => {
          const open = openRace === race.raceId;
          const clashHorse = takenRaces.get(race.raceId);
          const raceName = race.runners[0] as PricedRunner & { raceName?: string | null };
          return (
            <div
              key={race.raceId}
              className="rounded-xl bg-[#f6f4f8] p-2"
            >
              <button
                type="button"
                onClick={() => setOpenRace(open ? null : race.raceId)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left"
              >
                <span className="rounded-md bg-white px-2 py-0.5 text-[12px] font-extrabold tabular-nums text-[var(--slate)]">
                  {race.offTime}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-[var(--slate)]">
                  {raceName?.raceName ?? race.course}
                </span>
                {clashHorse && (
                  <span className="shrink-0 rounded-full bg-[#eaf7f0] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-[var(--go-deep)]">
                    Picked: {clashHorse}
                  </span>
                )}
                <span
                  className={`shrink-0 text-[var(--slate-soft)] transition-transform ${open ? "rotate-90" : ""}`}
                  aria-hidden
                >
                  ›
                </span>
              </button>

              {open && (
                <ul className="mt-1 divide-y divide-[#eef2f6] rounded-lg bg-white">
                  {race.runners
                    .slice()
                    .sort((a, b) => b.price - a.price)
                    .map((h) => {
                      const picked = horseIds.includes(h.horseId);
                      const clashElsewhere = !!clashHorse && !picked;
                      const blocked =
                        !picked &&
                        (clashElsewhere || horsesFull || !canAffordHorse(h) || locked);
                      return (
                        <li key={h.horseId}>
                          <button
                            type="button"
                            onClick={() => onToggleHorse(h)}
                            disabled={blocked}
                            className={`flex w-full items-center gap-3 px-3 py-2 text-left ${
                              picked ? "bg-[#eaf7f0]" : ""
                            } ${blocked ? "opacity-45" : ""}`}
                          >
                            {h.silkUrl ? (
                              /* eslint-disable-next-line @next/next/no-img-element */
                              <img src={h.silkUrl} alt="" width={36} height={36} className="h-8 w-8 shrink-0 object-contain" />
                            ) : (
                              <div className="h-8 w-8 shrink-0 rounded bg-[#efe9f1]" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[13px] font-bold text-[var(--slate)]">
                                {h.horse}
                              </div>
                              <div className="truncate text-[11px] text-[var(--slate-soft)]">
                                {h.jockey ?? "—"} · {h.frac}
                              </div>
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="text-[14px] font-extrabold tabular-nums text-[var(--slate)]">
                                {money(h.price)}
                              </div>
                              <div className="text-[10px] font-semibold uppercase text-[var(--slate-soft)]">
                                {picked ? "Picked" : "Pick"}
                              </div>
                            </div>
                          </button>
                        </li>
                      );
                    })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SubTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg py-2 text-[12.5px] font-extrabold transition-colors ${
        active ? "bg-white text-[var(--slate)] shadow-sm" : "text-[var(--slate-soft)]"
      }`}
    >
      {children}
    </button>
  );
}
