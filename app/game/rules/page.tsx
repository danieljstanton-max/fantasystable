/**
 * Rules.
 *
 * The full ruleset as an accordion so a player can pick the section they
 * need without scrolling past the ones they don't. Every scoring number and
 * threshold is imported from `lib/game-pricing.ts` and `lib/lock.ts` so this
 * page and the scorer cannot drift.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { GameShell, SubpageHeader } from "@/components/game/game-shell";
import {
  BUDGET,
  HORSE_MAX,
  HORSE_MIN,
  JOCKEY_MAX,
  JOCKEY_MIN,
  JOCKEY_POINTS,
  N_HORSES,
  N_JOCKEYS,
  N_SALES,
  NAP_MULTIPLIER,
  NON_COMPLETION_POINTS,
  PLACE_POINTS,
  WIN_POINTS,
} from "@/lib/game-pricing";
import { LOCK_OFFSET_MS } from "@/lib/lock";
import { Example, Note, P, RulesAccordion, Table, type RuleSection } from "./rules-accordion";

export const metadata: Metadata = { title: "Rules — Fantasy Stable" };

const LOCK_HOURS = LOCK_OFFSET_MS / (60 * 60 * 1000);

export default function RulesPage() {
  const sections: RuleSection[] = [
    {
      id: "stable",
      title: "The Stable",
      summary: `Pick ${N_HORSES} horses and ${N_JOCKEYS} jockeys from £${BUDGET}m.`,
      body: (
        <>
          <P>
            Your stable is <b>{N_HORSES} horses</b> and <b>{N_JOCKEYS} jockeys</b>, chosen from the
            game card each game week. You have a total budget of <b>£{BUDGET}m</b> to spend across
            the whole stable. You can spend it all or hold some back — a full bank sits with you and
            can be used later in the week if you sell a horse (see Sales).
          </P>
          <P>
            <b>One horse per race.</b> You can&rsquo;t back two horses in the same race hoping one
            wins. If you pick a horse in the 15:40 you can&rsquo;t also pick another from that race
            — the game grey-outs the rest of the field to remind you.
          </P>
          <P>
            One of your six horses is your <b>NAP</b> — the horse you&rsquo;re most confident about.
            The NAP&rsquo;s points are doubled. Pick it right and you set the tone; pick it wrong
            and you feel it more than any other choice.
          </P>
          <Note>
            The one-per-race rule is the constraint that gives the game its shape. Without it you
            could back the whole field of a big handicap; with it you have to choose.
          </Note>
        </>
      ),
    },

    {
      id: "pricing",
      title: "Prices",
      summary: "Set by the market. Refreshed every 15 minutes.",
      body: (
        <>
          <P>
            Every horse and jockey has a price, in £m, on a scale that runs from{" "}
            <b>
              £{HORSE_MIN}m to £{HORSE_MAX}m
            </b>{" "}
            for horses and <b>
              £{JOCKEY_MIN}m to £{JOCKEY_MAX}m
            </b>{" "}
            for jockeys. Short-priced favourites are dear; a rank outsider costs a fraction of one.
          </P>
          <P>
            Prices come off the <b>overnight show</b> (the market as it stands the evening before
            the card) and refresh every <b>15 minutes</b> right up to the deadline. If a horse gets
            backed hard overnight, its price will rise; if it drifts, its price falls.
          </P>
          <P>
            A jockey&rsquo;s price is based on their book of rides on the game card — a jockey with
            a strong book on live chances costs more than one with two 50/1 shots.
          </P>
          <Example>
            A horse opens at 12/1 and gets steamed into 3/1 by the off. Its price this morning was
            £6.5m; by lunchtime it&rsquo;s £13.5m. If you picked it early, you&rsquo;re holding
            twice the price you paid — and you can bank the profit by selling.
          </Example>
        </>
      ),
    },

    {
      id: "horse-scoring",
      title: "How Horses Score",
      summary: "Win = 25 + bonus. Place. Fall = −5.",
      body: (
        <>
          <P>
            Your horses score points based on where they finish. Placings pay steeply because
            placing is not the job — the game rewards winners.
          </P>
          <Table
            rows={[
              ["Winner (1st)", `${WIN_POINTS} pts + longshot bonus`],
              ["2nd", `${PLACE_POINTS[2]} pts`],
              ["3rd", `${PLACE_POINTS[3]} pts`],
              ["4th", `${PLACE_POINTS[4]} pts`],
              ["5th", `${PLACE_POINTS[5]} pts`],
              ["6th or worse", "0 pts"],
              ["Non-runner (withdrawn)", "0 pts"],
              ["Fell, Pulled up, Unseated, Refused", `${NON_COMPLETION_POINTS} pts`],
            ]}
          />
          <P>
            <b>Non-runners never hurt you.</b> If your horse is scratched after the deadline it
            simply scores zero — you don&rsquo;t lose the points, you just don&rsquo;t gain any.
            That&rsquo;s the fairness rule; you couldn&rsquo;t know when you picked, so you
            shouldn&rsquo;t be punished for it.
          </P>
          <P>
            Fallers, pulled-up horses and refusals give you <b>{NON_COMPLETION_POINTS} points</b>.
            That&rsquo;s a real penalty, and it&rsquo;s deliberate — the game punishes stacking a
            stable with 20/1 chances at big fences.
          </P>
        </>
      ),
    },

    {
      id: "dead-heats",
      title: "Dead Heats",
      summary: "Tie for a position — points are shared.",
      body: (
        <>
          <P>
            When two or more horses cross the line together and share a finishing position, the
            points for that position are <b>divided equally between them</b>. Same rule a
            bookmaker uses: a dead heat is settled at half the price.
          </P>
          <Example>
            Two horses dead-heat for the win. Instead of 25 points each, they get{" "}
            {WIN_POINTS / 2} points each. Add the longshot bonus at the same halved rate. If your
            horse was the NAP, the ×{NAP_MULTIPLIER} is applied on top — so a NAP dead-heat winner
            scores the same as a normal solo winner would.
          </Example>
          <P>
            The same rule applies to your jockeys: if a rider dead-heats for the win, their share
            of the jockey win points is halved. It&rsquo;s automatic — the results page marks a
            dead-heat position with an <b>=</b>, so <b>=1st</b> means shared first.
          </P>
        </>
      ),
    },

    {
      id: "longshot",
      title: "The Longshot Bonus",
      summary: "Bigger the SP, bigger the bonus.",
      body: (
        <>
          <P>
            When your horse wins, you get the <b>{WIN_POINTS} points</b> plus a bonus based on the
            starting price. The bigger the price, the bigger the bonus:
          </P>
          <Table
            rows={[
              ["Winner shorter than 3/1", "+0"],
              ["3/1 – 7/1", "+2"],
              ["8/1 – 15/1", "+5"],
              ["16/1 – 27/1", "+9"],
              ["28/1 or bigger", "+14"],
            ]}
          />
          <P>
            The bonus is added <b>before</b> the NAP multiplier. So napping a 20/1 winner is worth
            (25 + 9) × 2 = <b>68 points</b> — the single biggest score in the game.
          </P>
          <Note>
            The bonus exists so that a stable of longshots isn&rsquo;t always inferior to a stable of
            favourites. Backed correctly, a 20/1 winner should be worth more than a 5/2 winner
            — because it&rsquo;s harder to find.
          </Note>
        </>
      ),
    },

    {
      id: "nap",
      title: "The NAP",
      summary: `Your best pick — its points are ×${NAP_MULTIPLIER}.`,
      body: (
        <>
          <P>
            One horse in your stable is your NAP. Whatever that horse scores — win, place,
            longshot bonus — is <b>multiplied by ×{NAP_MULTIPLIER}</b>. That includes negative points
            if it falls, so name the NAP with confidence, not with hope.
          </P>
          <P>
            You can <b>change your NAP</b> right up to the deadline. Tap the yellow{" "}
            <span className="rounded-full bg-[#ffd21e] px-1.5 py-0.5 text-[9px] font-extrabold text-[#7a5b00]">
              NAP?
            </span>{" "}
            badge on any horse in your stable and it swaps — the previous NAP loses the double, the
            new one gets it.
          </P>
          <P>
            After the deadline the NAP is locked in with the rest of your team.
          </P>
        </>
      ),
    },

    {
      id: "jockeys",
      title: "How Jockeys Score",
      summary: `${JOCKEY_POINTS[1]} / ${JOCKEY_POINTS[2]} / ${JOCKEY_POINTS[3]} per ride, summed across the card.`,
      body: (
        <>
          <P>
            Your two jockeys score across <b>every ride they have on the game card</b>. Rides at
            meetings that aren&rsquo;t on the card don&rsquo;t count — same rule for everyone.
          </P>
          <Table
            rows={[
              ["Win", `${JOCKEY_POINTS[1]} pts per ride`],
              ["2nd", `${JOCKEY_POINTS[2]} pts per ride`],
              ["3rd", `${JOCKEY_POINTS[3]} pts per ride`],
              ["Anywhere else", "0 pts"],
              ["Non-runners", "0 pts (harmless)"],
            ]}
          />
          <P>
            A jockey&rsquo;s <b>NAP has no effect</b> on their score — the NAP is a horse
            multiplier only.
          </P>
          <Example>
            You pick William Buick, who has five rides on the card. He wins two, is 3rd in another,
            unplaced in two more. That&rsquo;s ({JOCKEY_POINTS[1]} × 2) + {JOCKEY_POINTS[3]} ={" "}
            {JOCKEY_POINTS[1] * 2 + JOCKEY_POINTS[3]} points from one jockey slot.
          </Example>
        </>
      ),
    },

    {
      id: "sales",
      title: "Sales",
      summary: `${N_SALES} per game week — sell at current market price.`,
      body: (
        <>
          <P>
            You get <b>{N_SALES} sales</b> to use each game week. Tap <b>Sell a Horse</b> from your
            stable, pick which one, and the auction hammer shows what it&rsquo;s worth at the
            current market price. Confirm the sale and the money goes straight to your bank.
          </P>
          <P>
            The <b>sale price is the horse&rsquo;s current price</b> — the same price it&rsquo;s
            trading at on the pitch. Not what you originally paid. If a horse has shortened since
            you bought it, you&rsquo;ll sell for a profit; if it&rsquo;s drifted, you&rsquo;ll sell
            for less. The Sell sheet shows both numbers so you know.
          </P>
          <Example>
            You bought a horse at 12/1 for £6.5m. By the deadline it&rsquo;s 3/1F and costs £13.5m.
            Sell it for £13.5m — that&rsquo;s £7m of profit — and use the bank to bring in the star
            you couldn&rsquo;t afford this morning.
          </Example>
          <Note>
            Sales let a good early call pay off twice — once when the horse runs, and once in cash
            when the market comes to you.
          </Note>
        </>
      ),
    },

    {
      id: "deadline",
      title: "The Deadline",
      summary: `Card locks ${LOCK_HOURS} hour before the first race.`,
      body: (
        <>
          <P>
            The card locks <b>{LOCK_HOURS} hour before the first race</b> on the day&rsquo;s game
            card. After that you can&rsquo;t add or remove horses, change your NAP, or sell.
            Whatever you&rsquo;ve saved is what scores.
          </P>
          <P>
            The one-hour buffer gives you time to react to the last non-runners and jockey changes
            before racing starts, without letting people wait until the horses are being loaded into
            the stalls.
          </P>
          <P>
            <b>Nobody can see anyone else&rsquo;s stable until the deadline passes.</b> Before then
            all stables are private — no leaderboard row is tappable, no picks visible. Once the
            deadline hits, you can tap any name on the leaderboard to see what they picked.
          </P>
          <Note>
            The private-until-lock rule stops copycat sabotage of a leaderboard leader.
          </Note>
        </>
      ),
    },

    {
      id: "the-card",
      title: "The Card",
      summary: "12 races from the 4 richest GB/IRE meetings.",
      body: (
        <>
          <P>
            Each game week runs on the <b>four richest meetings</b> in Britain and Ireland that day,
            up to <b>12 featured races</b> in total. The pool is the entire field of every race on
            those meetings — that&rsquo;s where the six horses come from, and where a jockey&rsquo;s
            rides count.
          </P>
          <P>
            Horses at meetings that aren&rsquo;t on the card aren&rsquo;t in the pool. That&rsquo;s
            the same rule for every player and it keeps the game to a size you can actually think
            about — six horses picked from four hundred runners is a phone book, not a game.
          </P>
          <P>
            Racing at other meetings still happens, and might affect a jockey&rsquo;s form or a
            trainer&rsquo;s day — but only rides on the game card contribute to your score.
          </P>
        </>
      ),
    },

    {
      id: "leagues",
      title: "Leagues",
      summary: "Play your mates. Same rules, different opponents.",
      body: (
        <>
          <P>
            The <b>Overall</b> leaderboard is every player, every week. On top of that you can join
            or create as many <b>mini-leagues</b> as you like.
          </P>
          <P>
            <b>Create a league</b> — give it a name; you get a six-character code and a shareable
            link. Send either to anyone you want in it. They tap the link (or type the code into{" "}
            <b>Join a League</b>) and they&rsquo;re in.
          </P>
          <P>
            Scoring is identical everywhere — leagues are a filter over the same points. Being top
            of your mates&rsquo; league doesn&rsquo;t change your Overall rank; the numbers are the
            same, the standings just look different.
          </P>
          <Note>
            Companies and pubs run their own leagues — a sports bar can put its name at the top of a
            mini-league and get regulars to join for the year.
          </Note>
        </>
      ),
    },

    {
      id: "festivals",
      title: "Festivals",
      summary: "Multi-day leaderboards for the big meetings.",
      body: (
        <>
          <P>
            Big meetings run their own leaderboard scored over the <b>whole festival</b>:
          </P>
          <Table
            rows={[
              ["The Cheltenham Festival", "4 days · March"],
              ["The Grand National meeting", "3 days · April"],
              ["Royal Ascot", "5 days · June"],
              ["Glorious Goodwood", "5 days · July"],
            ]}
          />
          <P>
            Every stable you save during that week counts towards the festival leaderboard. You get
            a leader after each day; the trophy is decided on the total points across the meeting.
          </P>
        </>
      ),
    },

    {
      id: "fair-play",
      title: "Fair Play",
      summary: "Same card, same clock, same rules, no stake.",
      body: (
        <>
          <P>
            Every player plays the <b>same card</b> — the featured meetings and races are chosen
            before anyone signs in for the week, so nobody has a picks advantage from tab-switching
            to a different meeting.
          </P>
          <P>
            Every player plays on the <b>same clock</b> — the deadline is the same for everyone, one
            hour before the first race. Prices update on the same 15-minute tick for everyone.
          </P>
          <P>
            <b>Non-runners are always harmless.</b> A withdrawn horse scores zero, never a penalty.
            You couldn&rsquo;t know it would be scratched when you picked, so you don&rsquo;t suffer
            for it.
          </P>
          <P>
            <b>Free to play. A game of skill. No stake, no cash prize.</b> If a bookmaker or sponsor
            runs a prize pool for a league, that&rsquo;s separate from the game itself — you never
            pay to play here.
          </P>
        </>
      ),
    },
  ];

  return (
    <GameShell>
      <SubpageHeader title="Rules" />

      <RulesAccordion sections={sections} />

      <div className="rounded-[22px] bg-white p-5 text-center shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
        <p className="text-[13px] text-[var(--slate-soft)]">Ready to pick your six?</p>
        <Link
          href="/game"
          className="mt-3 inline-block rounded-xl bg-[linear-gradient(180deg,#1adc86,#04b56b)] px-7 py-2.5 text-[14px] font-extrabold text-white shadow-[0_2px_6px_rgba(4,181,107,0.35)]"
        >
          Back to your stable
        </Link>
      </div>
    </GameShell>
  );
}
