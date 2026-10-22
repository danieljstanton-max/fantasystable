/**
 * Push a long-form article, with its selections enriched from our own data.
 *
 *   npm run publish:article -- articles/cheltenham-friday.md
 *   npm run publish:article -- articles/cheltenham-friday.md --live
 *
 * Dan, 2026-10-22, the night before the Cheltenham October meeting: "I have
 * written an article for the website... the horses i have picked can we add
 * there jockey colours and prices i have selected from the API and make it
 * like all our picks where the price updates?"
 *
 * The prose is his. Everything factual around it is read from the database
 * rather than retyped: the silk, the jockey, the trainer, the racecard number
 * and the each-way terms. Retyping any of those is how a jockey who was
 * replaced at declaration time ends up on a live page.
 *
 * The advised price is the one HE named, frozen onto the article, because that
 * is the price he is accountable for. The CURRENT price is not stored at all —
 * the shortcode reads it from the race page, which the ten-minute odds push
 * keeps live, exactly as the best bets do.
 *
 * Front matter sits at the top of the markdown file between --- lines:
 *
 *   slug: cheltenham-october-friday-tips
 *   date: 2026-10-23
 *   course: Cheltenham
 *   picks:
 *     - 13:15 | Sunny South West | 4/1 | win
 *     - 15:00 | Cooltobecareless | 7/4 | win | nap
 *     - 16:45 | Fairlawn Skipper | 4/1 | win | nb
 */
import "dotenv/config";
import postgres from "postgres";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const LIVE = args.includes("--live");

interface Pick {
  time: string; horse: string; price: string; bet: string;
  nap?: boolean; nb?: boolean;
  course?: string; jockey?: string; trainer?: string; silk?: string;
  number?: number | null; places?: number | null;
}

/** Front matter, then body. */
function split(src: string): { meta: Record<string, string>; picks: Pick[]; body: string } {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return { meta: {}, picks: [], body: src };
  const meta: Record<string, string> = {};
  const picks: Pick[] = [];
  let inPicks = false;
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (/^picks:\s*$/.test(line)) { inPicks = true; continue; }
    if (inPicks && /^\s*-\s*/.test(line)) {
      const parts = line.replace(/^\s*-\s*/, "").split("|").map((p) => p.trim());
      if (parts.length < 3) continue;
      const [time, horse, price, bet = "win", ...flags] = parts;
      const f = flags.map((x) => x.toLowerCase());
      picks.push({ time, horse, price, bet, nap: f.includes("nap"), nb: f.includes("nb") });
      continue;
    }
    inPicks = false;
    const kv = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim();
  }
  return { meta, picks, body: m[2] };
}

/** Markdown to the HTML the site's editor would have produced. */
function toHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");

  const out: string[] = [];
  let table: string[][] | null = null;

  const flushTable = () => {
    if (!table || table.length < 2) { table = null; return; }
    const [head, , ...rows] = table;      // row 1 is the |---| separator
    out.push("<figure class=\"wp-block-table\"><table><thead><tr>" +
      head.map((h) => `<th>${inline(h)}</th>`).join("") + "</tr></thead><tbody>" +
      rows.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") +
      "</tbody></table></figure>");
    table = null;
  };

  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^\|.*\|$/.test(line)) {
      table = table ?? [];
      table.push(line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
      continue;
    }
    flushTable();
    if (!line) continue;
    if (/^---+$/.test(line)) { out.push("<hr class=\"wp-block-separator\">"); continue; }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const n = Math.min(h[1].length + 1, 4); out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }
    out.push(`<p>${inline(line)}</p>`);
  }
  flushTable();
  return out.join("\n");
}

async function main() {
  if (!file) { console.error("usage: npm run publish:article -- <file.md> [--live]"); process.exit(1); }
  const { meta, picks, body } = split(readFileSync(file, "utf8"));
  const date = meta.date, slug = meta.slug, course = meta.course ?? "";
  if (!date || !slug) { console.error("front matter needs `slug:` and `date:`"); process.exit(1); }

  const title = (body.match(/^#\s+(.*)$/m) ?? [])[1]?.trim()
    ?? meta.title ?? slug.replace(/-/g, " ");
  // The H1 is the post title; WordPress renders it, so it must not also sit in
  // the body or the page carries two of them.
  const html = toHtml(body.replace(/^#\s+.*$/m, "")) +
    `\n<!-- wp:shortcode -->\n[hrt_article_picks heading="Every selection"]\n<!-- /wp:shortcode -->`;

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, ssl: "require" });
  const filled: Pick[] = [];
  for (const p of picks) {
    const [r] = await sql<any[]>`
      SELECT ra.course_name, ra.off_time, ru.horse_name, ru.number, ru.jockey_name,
             ru.jockey_claim_lbs claim, ru.trainer_name, ru.ew_places, ru.is_non_runner,
             ru.raw->>'silk_url' silk
      FROM runners ru JOIN races ra ON ra.id = ru.race_id
      WHERE ra.race_date = ${date} AND ra.off_time = ${p.time}
        AND upper(ru.horse_name) = ${p.horse.toUpperCase()}
        ${course ? sql`AND ra.course_name ILIKE ${"%" + course + "%"}` : sql``}`;
    if (!r) {
      console.error(`  ! ${p.time} ${p.horse} — not a declared runner. Fix the file; nothing sent.`);
      process.exit(1);
    }
    if (r.is_non_runner) console.error(`  ! ${p.horse} is a NON-RUNNER — it will show as one on the page.`);
    filled.push({
      ...p,
      course: String(r.course_name),
      horse: String(r.horse_name),
      jockey: `${r.jockey_name}${r.claim ? ` (${r.claim})` : ""}`,
      trainer: String(r.trainer_name),
      silk: r.silk ?? undefined,
      number: r.number === null ? null : Number(r.number),
      places: r.ew_places === null ? null : Number(r.ew_places),
    });
    console.log(`  ${p.time} ${String(r.horse_name).toUpperCase().padEnd(20)} ${p.price.padEnd(6)} ${p.bet.padEnd(9)}` +
      `${p.nap ? "NAP " : p.nb ? "NB  " : "    "}${r.silk ? "silk ok" : "NO SILK"}`);
  }
  await sql.end();

  const site = process.env.HRT_URL, token = process.env.HRT_TOKEN;
  if (!site || !token) { console.error("Missing HRT_URL / HRT_TOKEN"); process.exit(1); }

  const res = await fetch(`${site.replace(/\/$/, "")}/wp-json/hrt/v1/article`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-HRT-Token": token },
    body: JSON.stringify({
      slug, date, title, html, picks: filled,
      excerpt: meta.excerpt ?? "",
      status: LIVE ? "publish" : "draft",
    }),
  });
  const text = await res.text();
  if (!res.ok) { console.error(`Failed (${res.status}): ${text.slice(0, 400)}`); process.exit(1); }
  const json = JSON.parse(text);

  console.log(`\n  ${json.created ? "created" : "updated"} — ${json.status}`);
  console.log(`  ${json.picks} selections`);
  console.log(`  ${json.url}`);

  // A success response is not proof the page resolves. Check it.
  if (json.status === "publish" && json.url) {
    const check = await fetch(json.url, { method: "HEAD", redirect: "manual",
      headers: { "cache-control": "no-cache" } });
    if (check.status !== 200) {
      console.error(`  VERIFY FAILED — ${check.status} at ${json.url}`);
      process.exit(2);
    }
    console.log(`  verified live (${check.status})`);
  }
  console.log("");
}

main().catch((e) => { console.error("\narticle publish failed:", e?.message ?? e); process.exit(1); });
