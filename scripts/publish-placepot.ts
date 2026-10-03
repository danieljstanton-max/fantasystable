/**
 * Push the day's placepot to the site.
 *
 *   npm run publish:placepot -- 2026-10-04
 *
 * The selections only. Whether each leg placed is worked out on the site from
 * the result it already holds for that race — the same way the Lucky 15 settles
 * itself — so a leg marks itself placed within ten minutes of the race without
 * anything being pushed again.
 */
import "dotenv/config";
import { buildPlacepots } from "./placepot";

async function main() {
  const date = process.argv[2];
  if (!date) { console.error("usage: npm run publish:placepot -- YYYY-MM-DD"); process.exit(1); }

  const all = await buildPlacepots(date, (process.argv.find((a) => a.startsWith("--course=")) ?? "").split("=")[1]);
  if (!all.length) { console.log(`No meeting on ${date} has six priced races — nothing sent.`); return; }

  const site = process.env.HRT_URL, token = process.env.HRT_TOKEN;
  if (!site || !token) { console.error("Missing HRT_URL / HRT_TOKEN"); process.exit(1); }

  const url = `${site.replace(/\/$/, "")}/wp-json/hrt/v1/placepot/${date}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-HRT-Token": token },
    body: JSON.stringify({ date, meetings: all }),
  });
  const text = await res.text();
  if (!res.ok) { console.error(`Failed (${res.status}): ${text.slice(0, 400)}`); process.exit(1); }

  console.log(`  ${all.length} meeting${all.length === 1 ? "" : "s"} pushed for ${date}`);
  for (const pp of all)
    console.log(`    ${pp.course.padEnd(18)} ${pp.legs.map((l) => String(l.number).padStart(2)).join(" ")}   ${(pp.survival * 100).toFixed(1)}%`);
}
main().catch((e) => { console.error(e?.message ?? e); process.exit(1); });
