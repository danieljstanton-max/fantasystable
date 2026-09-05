/**
 * Who has signed up?
 *
 *   npm run users
 *   npm run users -- --count       # just the total
 *   npm run users -- --with-stables # add each user's saved stables
 *
 * A quick back-office peek at registrations. Prints one row per user with
 * signup timestamp, email, display name, and their opt-in flags. Handy
 * before we build a real admin page.
 */

import "dotenv/config";
import { db, stables, users } from "../db";
import { desc, eq } from "drizzle-orm";

const wantsCountOnly = process.argv.includes("--count");
const wantsStables = process.argv.includes("--with-stables");

(async () => {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      stableName: users.stableName,
      createdAt: users.createdAt,
      ageConfirmedAt: users.ageConfirmedAt,
      optedOut: users.announcementsOptOutAt,
      isAdmin: users.isAdmin,
    })
    .from(users)
    .orderBy(desc(users.createdAt));

  if (wantsCountOnly) {
    console.log(rows.length);
    process.exit(0);
  }

  console.log(`${rows.length} user${rows.length === 1 ? "" : "s"}\n`);
  for (const u of rows) {
    const when = u.createdAt?.toISOString().replace("T", " ").slice(0, 16) ?? "—";
    const name = u.displayName ?? u.email.split("@")[0];
    const stable = u.stableName ? ` · stable “${u.stableName}”` : "";
    const flags = [
      u.isAdmin ? "admin" : null,
      u.ageConfirmedAt ? null : "no-age-confirm",
      u.optedOut ? "opted-out" : null,
    ]
      .filter(Boolean)
      .join(", ");
    console.log(`  ${when}  ${u.email.padEnd(32)} ${name}${stable}${flags ? `  (${flags})` : ""}`);

    if (wantsStables) {
      const s = await db
        .select({ raceDate: stables.raceDate, points: stables.points, lockedAt: stables.lockedAt })
        .from(stables)
        .where(eq(stables.userId, u.id))
        .orderBy(desc(stables.raceDate));
      for (const st of s) {
        const locked = st.lockedAt ? "locked" : "open";
        console.log(`      ${st.raceDate}  ${(st.points ?? 0).toString().padStart(4)} pts  (${locked})`);
      }
    }
  }
  process.exit(0);
})();
