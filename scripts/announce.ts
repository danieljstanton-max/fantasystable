/**
 * Broadcast an email to every registered player.
 *
 *   npm run announce -- --subject "Race Week 1 is live" --body ./announce.md
 *   echo "See you at 14:30." | npm run announce -- --subject "3 hours to go" --stdin
 *   npm run announce -- --dry               # count recipients, send nothing
 *
 * Records the send in the `announcements` table so we always know what
 * went out. The email carries a unique unsubscribe link per recipient.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { sendAnnouncement, loadRecipients } from "../lib/announcements";

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

(async () => {
  const dry = process.argv.includes("--dry");
  const subject = arg("--subject");
  const bodyPath = arg("--body");
  const useStdin = process.argv.includes("--stdin");
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const sentBy = process.env.USER ?? "cli";

  if (dry) {
    const recipients = await loadRecipients();
    console.log(`dry run: ${recipients.length} recipients`);
    if (recipients.length) {
      console.log(`  first: ${recipients.slice(0, 5).map((r) => r.email).join(", ")}`);
    }
    process.exit(0);
  }

  if (!subject) {
    console.error("--subject is required");
    process.exit(1);
  }
  const body = useStdin
    ? readFileSync(0, "utf8")
    : bodyPath
      ? readFileSync(bodyPath, "utf8")
      : null;
  if (!body?.trim()) {
    console.error("body required — pass --body <file> or --stdin");
    process.exit(1);
  }

  console.log(`sending: ${subject}`);
  const report = await sendAnnouncement(subject, body, sentBy, origin);
  console.log(report);
  process.exit(0);
})();
