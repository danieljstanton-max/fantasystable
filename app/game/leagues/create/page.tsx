/**
 * Create a League.
 *
 * The form is one field (league name); everything else — the join code, the
 * shareable URL — is generated when they submit. Public URLs are the growth
 * mechanic: a code by itself is friction; a link is one tap.
 *
 * The submitted page shows both. Code is prominent because a punter reading
 * out a code in a WhatsApp group is a real thing that happens. URL sits
 * beneath with a copy button.
 */

import type { Metadata } from "next";
import { GameShell, SubpageHeader } from "@/components/game/game-shell";
import { CreateLeagueForm } from "./create-form";

export const metadata: Metadata = { title: "Create a League — Fantasy Stable" };
export const dynamic = "force-dynamic";

export default async function CreateLeaguePage() {
  return (
    <GameShell>
      <SubpageHeader title="Create a League" />

      <div className="rounded-[22px] bg-white p-5 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
        <p className="text-[14px] leading-relaxed text-[var(--slate-soft)]">
          Give your league a name. You&rsquo;ll get a code and a link you can share — anyone with
          either can join.
        </p>

        <CreateLeagueForm />
      </div>

      <div className="rounded-[22px] bg-white/85 p-5 text-[12.5px] leading-relaxed text-[var(--slate-soft)] shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
        <p className="font-semibold text-[var(--slate)]">Two things worth knowing</p>
        <ul className="mt-2 space-y-1.5">
          <li>· Scoring uses the same rules as every league — the difference is who&rsquo;s in it.</li>
          <li>· You can rename or archive the league later from the league page.</li>
        </ul>
      </div>
    </GameShell>
  );
}
