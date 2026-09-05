/**
 * Flip a user to admin.
 *
 *   npm run admin -- <email>
 *
 * Prints one line either way. Admin status gates /game/admin — see that
 * page for what's visible once flipped. No-op if the flag is already set.
 */

import "dotenv/config";
import { db, users } from "../db";
import { eq } from "drizzle-orm";

(async () => {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!email) {
    console.error("usage: npm run admin -- <email>");
    process.exit(1);
  }

  const user = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];
  if (!user) {
    console.error(`no user with email ${email}`);
    process.exit(1);
  }

  if (user.isAdmin) {
    console.log(`${email} was already admin`);
    process.exit(0);
  }

  await db.update(users).set({ isAdmin: true }).where(eq(users.id, user.id));
  console.log(`${email} is now admin — sign in and visit /game/admin`);
  process.exit(0);
})();
