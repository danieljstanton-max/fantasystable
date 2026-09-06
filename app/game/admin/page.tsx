/**
 * Admin tab — the back office.
 *
 * Gated by `users.isAdmin`. Non-admins are redirected to /game rather than
 * shown a "no access" page; the tab's existence isn't information the public
 * needs, and a 404-like bounce doesn't confirm the URL to a poker anyone.
 *
 * Read-only for now: who signed up, when, what they're set for, and which
 * broadcasts have gone out. Write actions (edit a stable name, flip an
 * admin flag, resend an announcement) live in follow-up commits — the point
 * of this first pass is just a real window into the audience.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { db, announcements, stables, users } from "@/db";
import { desc, eq, sql } from "drizzle-orm";
import { GameShell, SubpageHeader } from "@/components/game/game-shell";
import { nextGameDate } from "@/lib/game-data";
import { SettleButton } from "./settle-button";
import { NrSweepButton, RecapButton } from "./ops-buttons";

export const metadata: Metadata = { title: "Admin — Fantasy Stable" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const me = await currentUser();
  if (!me) redirect("/game/sign-in");

  const admin = (
    await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, me.id)).limit(1)
  )[0];
  if (!admin?.isAdmin) redirect("/game");

  const settleDefaultDate = await nextGameDate();

  const [userRows, stableCountRow, latestStables, sends] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        stableName: users.stableName,
        createdAt: users.createdAt,
        ageConfirmedAt: users.ageConfirmedAt,
        optedOut: users.announcementsOptOutAt,
        isAdmin: users.isAdmin,
        lastSeenAt: users.lastSeenAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt)),
    db.select({ n: sql<number>`count(*)::int` }).from(stables),
    db
      .select({
        userId: stables.userId,
        raceDate: stables.raceDate,
        points: stables.points,
        lockedAt: stables.lockedAt,
        updatedAt: stables.updatedAt,
      })
      .from(stables)
      .orderBy(desc(stables.updatedAt))
      .limit(20),
    db.select().from(announcements).orderBy(desc(announcements.sentAt)).limit(10),
  ]);

  const totalUsers = userRows.length;
  const optedOut = userRows.filter((u) => u.optedOut).length;
  const totalStables = stableCountRow[0]?.n ?? 0;

  return (
    <GameShell>
      <SubpageHeader title="Admin" />
      <div className="flex flex-col gap-3">
        <StatRow
          cells={[
            { label: "Users", value: totalUsers },
            { label: "Opted out", value: optedOut },
            { label: "Stables saved", value: totalStables },
            { label: "Broadcasts sent", value: sends.length },
          ]}
        />

        <Card title="Users" subtitle="Newest first">
          {userRows.length === 0 ? (
            <Empty text="Nobody's signed up yet." />
          ) : (
            <div className="-mx-3 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[13px]">
                <thead className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--slate-soft)]">
                  <tr>
                    <Th>Signed up</Th>
                    <Th>Email</Th>
                    <Th>Name</Th>
                    <Th>Stable</Th>
                    <Th>Last seen</Th>
                    <Th>Flags</Th>
                  </tr>
                </thead>
                <tbody>
                  {userRows.map((u) => (
                    <tr key={u.id} className="border-t border-[#eef2f6]">
                      <Td mono>{fmtDate(u.createdAt)}</Td>
                      <Td>{u.email}</Td>
                      <Td>{u.displayName ?? "—"}</Td>
                      <Td>{u.stableName ?? "—"}</Td>
                      <Td mono>{fmtDate(u.lastSeenAt)}</Td>
                      <Td>
                        <Flags
                          admin={u.isAdmin}
                          noAge={!u.ageConfirmedAt}
                          optedOut={!!u.optedOut}
                        />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title="Recent stables"
          subtitle="Last 20 saved, newest first"
        >
          {latestStables.length === 0 ? (
            <Empty text="No stables saved yet." />
          ) : (
            <div className="-mx-3 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-[13px]">
                <thead className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--slate-soft)]">
                  <tr>
                    <Th>Saved</Th>
                    <Th>Race date</Th>
                    <Th>User</Th>
                    <Th>Points</Th>
                    <Th>Locked</Th>
                  </tr>
                </thead>
                <tbody>
                  {latestStables.map((s, i) => {
                    const u = userRows.find((x) => x.id === s.userId);
                    return (
                      <tr key={`${s.userId}-${s.raceDate}-${i}`} className="border-t border-[#eef2f6]">
                        <Td mono>{fmtDate(s.updatedAt)}</Td>
                        <Td mono>{s.raceDate}</Td>
                        <Td>{u?.email ?? s.userId.slice(0, 8)}</Td>
                        <Td mono>{s.points ?? 0}</Td>
                        <Td>{s.lockedAt ? fmtDate(s.lockedAt) : "—"}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Broadcasts" subtitle="Announcement history">
          {sends.length === 0 ? (
            <Empty text="No broadcasts have been sent. Use `npm run announce` to send one." />
          ) : (
            <ul className="divide-y divide-[#eef2f6]">
              {sends.map((s) => (
                <li key={s.id} className="py-2.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[13.5px] font-bold text-[var(--slate)]">{s.subject}</span>
                    <span className="text-[11px] font-mono text-[var(--slate-soft)]">
                      {fmtDate(s.sentAt)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-[var(--slate-soft)]">
                    {s.recipients} recipient{s.recipients === 1 ? "" : "s"} · {s.delivered}{" "}
                    delivered · {s.optedOut} skipped (opt-out)
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Settle a card" subtitle="Idempotent — safe to hit again">
          <SettleButton defaultDate={settleDefaultDate} />
        </Card>

        <Card title="Non-runners" subtitle="Sweep + notify affected players">
          <NrSweepButton />
        </Card>

        <Card title="Post-day recap" subtitle="One summary email per entrant">
          <RecapButton defaultDate={settleDefaultDate} />
        </Card>

        <Card title="How to send a broadcast" subtitle="Run this from your terminal">
          <pre className="mt-2 overflow-x-auto rounded-lg bg-[#f6f4f8] px-3 py-2.5 text-[12px] text-[var(--slate)]">{`# Preview without sending
npm run announce -- --subject "Game 1 is live" --body path/to/body.md --dry

# Send for real
npm run announce -- --subject "Game 1 is live" --body path/to/body.md`}</pre>
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--slate-soft)]">
            Every email carries a one-tap unsubscribe. Opted-out users are skipped at the query
            stage — the count above stays honest about delivery, not intent.
          </p>
        </Card>
      </div>
    </GameShell>
  );
}

/* ------------------------------------------------------------- helpers */

function StatRow({ cells }: { cells: { label: string; value: number | string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {cells.map((c) => (
        <div key={c.label} className="rounded-2xl bg-white px-4 py-3 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-[var(--slate-soft)]">
            {c.label}
          </div>
          <div className="mt-1 text-[22px] font-extrabold tabular-nums text-[var(--slate)]">
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[22px] bg-white p-5 shadow-[0_2px_8px_rgba(23,48,60,0.06)]">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-extrabold uppercase tracking-tight text-[var(--slate)]">
          {title}
        </h2>
        {subtitle && (
          <span className="text-[11px] font-semibold text-[var(--slate-soft)]">{subtitle}</span>
        )}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 font-bold">{children}</th>;
}
function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return <td className={`px-3 py-2 align-top ${mono ? "font-mono tabular-nums text-[12px]" : ""}`}>{children}</td>;
}

function Flags({ admin, noAge, optedOut }: { admin: boolean; noAge: boolean; optedOut: boolean }) {
  const chips: { label: string; tone: "admin" | "warn" | "muted" }[] = [];
  if (admin) chips.push({ label: "admin", tone: "admin" });
  if (noAge) chips.push({ label: "no-age-confirm", tone: "warn" });
  if (optedOut) chips.push({ label: "opted out", tone: "muted" });
  if (chips.length === 0) return <span className="text-[var(--slate-soft)]">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {chips.map((c) => (
        <span
          key={c.label}
          className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] ${
            c.tone === "admin"
              ? "bg-[#eaf7f0] text-[var(--go-deep)]"
              : c.tone === "warn"
                ? "bg-[#fdecec] text-[#a3261f]"
                : "bg-[#f2edf4] text-[var(--slate-soft)]"
          }`}
        >
          {c.label}
        </span>
      ))}
    </span>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-[13px] leading-relaxed text-[var(--slate-soft)]">{text}</p>;
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16);
}
