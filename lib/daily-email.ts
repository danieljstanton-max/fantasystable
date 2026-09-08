/**
 * The morning email: did last night's card publish, and did it pass its checks?
 *
 * Dan, 2026-09-08: "can you confirm daily you will run the script and check
 * list" — and the honest answer was no, because I only exist when he messages
 * me. The nightly job runs the checks whether or not either of us remembers;
 * what was missing was any way for him to learn the result without going and
 * looking.
 *
 * So the job reports itself. Four gates, pass or fail, and either "published"
 * or "HELD — approval needed" with the reasons and the command to publish by
 * hand once he has read them.
 *
 * Uses the Resend transport the game already sends through (lib/mailer.ts), so
 * there is one mail path in the repo rather than two.
 */
import { sendMail } from "./mailer";

export interface GateResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface DailyReportSummary {
  date: string;
  label: string;
  races: number;
  selections: number;
  nap: string | null;
  gates: GateResult[];
  published: boolean;
  url: string | null;
  /** Anything that went wrong outside the gates — a failed push, a bad fetch. */
  errors: string[];
}

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function sendDailyReport(s: DailyReportSummary) {
  const to = process.env.DAILY_REPORT_TO || process.env.MAIL_FROM;
  if (!to) {
    console.warn("  no DAILY_REPORT_TO or MAIL_FROM set — daily email not sent");
    return;
  }

  const failed = s.gates.filter((g) => !g.passed);
  const ok = failed.length === 0 && s.published && s.errors.length === 0;

  // The subject line is the whole message for anyone reading on a phone.
  const subject = ok
    ? `✓ ${s.label} published — ${s.selections} selections, NAP ${s.nap ?? "none"}`
    : s.published
    ? `⚠ ${s.label} published with warnings`
    : `✗ ${s.label} HELD — approval needed`;

  const lines: string[] = [];
  lines.push(ok ? "Published and verified." : s.published
    ? "Published, but something needs your eye."
    : "NOT PUBLISHED. Nothing on the site has changed.");
  lines.push("");
  lines.push(`  Card       ${s.races} races, ${s.selections} selections`);
  lines.push(`  NAP        ${s.nap ?? "none"}`);
  if (s.url) lines.push(`  URL        ${s.url}`);
  lines.push("");
  lines.push("  Checks");
  for (const g of s.gates) {
    lines.push(`    ${g.passed ? "PASS" : "FAIL"}  ${g.name}`);
    if (!g.passed && g.detail) {
      for (const l of g.detail.split("\n").filter(Boolean).slice(0, 12)) {
        lines.push(`            ${l.trim()}`);
      }
    }
  }
  if (s.errors.length) {
    lines.push("");
    lines.push("  Errors");
    for (const e of s.errors) lines.push(`    ${e}`);
  }
  if (!s.published) {
    lines.push("");
    lines.push("  Once you are happy, publish by hand:");
    lines.push(`    npx tsx --env-file=.env.local scripts/publish.ts ${s.date} --live`);
  }

  const text = lines.join("\n");

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:640px;color:#0E1116">
  <p style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#5B6472;margin:0 0 4px">
    Horse Racing Tips &middot; nightly run</p>
  <h1 style="font-size:21px;margin:0 0 4px">${esc(s.label)}</h1>
  <p style="font-size:15px;margin:0 0 18px;color:${ok ? "#0B8457" : s.published ? "#B8860B" : "#E30118"};font-weight:700">
    ${ok ? "Published and verified" : s.published ? "Published with warnings" : "HELD — approval needed"}</p>

  <table style="border-collapse:collapse;font-size:14px;margin:0 0 18px">
    <tr><td style="padding:3px 16px 3px 0;color:#5B6472">Card</td><td>${s.races} races, ${s.selections} selections</td></tr>
    <tr><td style="padding:3px 16px 3px 0;color:#5B6472">NAP</td><td><strong>${esc(s.nap ?? "none")}</strong></td></tr>
    ${s.url ? `<tr><td style="padding:3px 16px 3px 0;color:#5B6472">URL</td><td><a href="${esc(s.url)}">${esc(s.url)}</a></td></tr>` : ""}
  </table>

  <table style="border-collapse:collapse;width:100%;font-size:14px">
    ${s.gates.map((g) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #E3E7EF;width:64px;
                   color:${g.passed ? "#0B8457" : "#E30118"};font-weight:700">
          ${g.passed ? "PASS" : "FAIL"}</td>
        <td style="padding:8px 0;border-bottom:1px solid #E3E7EF">
          ${esc(g.name)}
          ${!g.passed && g.detail ? `<div style="margin-top:6px;font-size:12.5px;color:#5B6472;white-space:pre-wrap">${esc(g.detail.split("\n").filter(Boolean).slice(0, 12).join("\n"))}</div>` : ""}
        </td>
      </tr>`).join("")}
  </table>

  ${s.errors.length ? `<div style="margin-top:16px;padding:12px 14px;background:#FFF4F4;border-left:4px solid #E30118;font-size:13px;white-space:pre-wrap">${esc(s.errors.join("\n"))}</div>` : ""}

  ${!s.published ? `
  <div style="margin-top:18px;padding:14px 16px;background:#F4F6FA;border-radius:10px;font-size:13.5px">
    <strong>Nothing on the site has changed.</strong> Yesterday's card is still up.<br>
    Once you are happy, publish by hand:
    <div style="margin-top:8px;font-family:ui-monospace,Menlo,monospace;font-size:12.5px">
      npx tsx --env-file=.env.local scripts/publish.ts ${esc(s.date)} --live</div>
  </div>` : ""}
</div>`.trim();

  const r = await sendMail({ to, subject, text, html });
  console.log(`  daily report emailed to ${to} (${r.via})`);
}
