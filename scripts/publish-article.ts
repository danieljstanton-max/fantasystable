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

/**
 * Markdown to HTML, built as race cards rather than a wall of paragraphs.
 *
 * Dan, 2026-10-23: "the article looks really basic — can you build each race
 * with a nice border, the selections you have here at the top, maybe different
 * shade background on picks."
 *
 * So a race is a card: a header carrying the time and course, a shaded bar
 * carrying the selection with its silk and price, the prose, and the verdict
 * line as a footer. A reader scanning for "what does he fancy in the 15:00"
 * finds it without reading six paragraphs first, and a reader who wants the
 * argument still has it underneath.
 *
 * The silk is emitted inline here rather than by the shortcode, because this
 * is where the enriched picks are. The shortcode owns the summary block at the
 * top; this owns the body.
 */
function renderArticle(md: string, picks: Pick[]): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (t: string) =>
    esc(t)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");

  const byHorse = new Map(picks.map((p) => [p.horse.toUpperCase(), p]));

  // A race heading is "## 13:15 Cheltenham". Anything else stays a plain
  // heading, so the intro, the summary and the closing sections are untouched.
  const RACE = /^##\s+(\d{1,2}:\d{2})\s+(.+?)\s*$/;

  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let race: { time: string; course: string; body: string[]; pick?: Pick; verdict?: string } | null = null;
  let table: string[][] | null = null;

  const flushTable = (sink: string[]) => {
    if (!table || table.length < 2) { table = null; return; }
    const [head, , ...rows] = table;
    sink.push('<figure class="wp-block-table hrt-art__table"><table><thead><tr>' +
      head.map((h) => `<th>${inline(h)}</th>`).join("") + "</tr></thead><tbody>" +
      rows.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") +
      "</tbody></table></figure>");
    table = null;
  };

  const closeRace = () => {
    if (!race) return;
    const p = race.pick;
    let html = '<section class="hrt-art__race' + (p?.nap ? " is-nap" : p?.nb ? " is-nb" : "") + '">';
    html += '<header class="hrt-art__raceHead">';
    html += `<span class="hrt-art__raceTime">${esc(race.time)}</span>`;
    html += `<span class="hrt-art__raceCourse">${esc(race.course)}</span>`;
    if (p?.nap) html += '<span class="hrt-art__tag">NAP</span>';
    else if (p?.nb) html += '<span class="hrt-art__tag hrt-art__tag--nb">Next best</span>';
    html += "</header>";

    if (p) {
      html += '<div class="hrt-art__bar">';
      html += p.silk
        ? `<img class="hrt-art__silk" loading="lazy" decoding="async" width="40" height="40" src="${p.silk}" alt="${esc(p.horse)} silks">`
        : '<span class="hrt-art__silk--none" aria-hidden="true"></span>';
      html += '<span class="hrt-art__barWho">';
      html += `<span class="hrt-art__barHorse">${esc(p.horse.toUpperCase())}</span>`;
      html += `<span class="hrt-art__barMeta">${esc([p.jockey, p.trainer].filter(Boolean).join(" · "))}</span>`;
      html += "</span>";
      html += `<span class="hrt-art__barPrice"><span class="hrt-art__barOdds">${esc(p.price)}</span>` +
        `<span class="hrt-art__barBet">${esc(p.bet)}</span></span>`;
      html += "</div>";
    }

    html += '<div class="hrt-art__prose">' + race.body.join("\n") + "</div>";
    if (race.verdict) {
      html += `<p class="hrt-art__verdict">${inline(race.verdict)}</p>`;
    }
    html += "</section>";
    out.push(html);
    race = null;
  };

  for (const raw of lines) {
    const line = raw.trim();

    if (/^\|.*\|$/.test(line)) {
      table = table ?? [];
      table.push(line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
      continue;
    }
    flushTable(race ? race.body : out);

    const r = line.match(RACE);
    if (r) { closeRace(); race = { time: r[1], course: r[2], body: [] }; continue; }

    // A non-race ## heading ends the current race card.
    if (/^##\s+/.test(line)) {
      closeRace();
      out.push(`<h2>${inline(line.replace(/^##\s+/, ""))}</h2>`);
      continue;
    }

    if (!line) continue;

    if (race) {
      // "### SUNNY SOUTH WEST – 4/1 (Bet365)" names the pick; the bar above
      // already carries it, so it is not repeated as a heading.
      const h3 = line.match(/^###\s+(.*)$/);
      if (h3) {
        const name = h3[1].split(/[–—-]/)[0].trim().toUpperCase();
        if (byHorse.has(name)) { race.pick = byHorse.get(name); continue; }
        race.body.push(`<h3>${inline(h3[1])}</h3>`);
        continue;
      }
      if (/^Selection:\s*/i.test(line)) { race.verdict = line; continue; }
      if (/^(VIP NAP|NEXT BEST)/i.test(line)) continue;   // the tag says it
      race.body.push(`<p>${inline(line)}</p>`);
      continue;
    }

    if (/^---+$/.test(line)) { out.push('<hr class="wp-block-separator">'); continue; }
    const h = line.match(/^(#{3,4})\s+(.*)$/);
    if (h) { out.push(`<h${Math.min(h[1].length + 1, 4)}>${inline(h[2])}</h${Math.min(h[1].length + 1, 4)}>`); continue; }
    out.push(`<p>${inline(line)}</p>`);
  }
  flushTable(race ? race.body : out);
  closeRace();

  // Wrapped in .hrt-art, and this is not optional.
  //
  // Dan, 2026-10-23, looking at a race card with no border and no shading:
  // "its nice but again - what did i ask for". He asked for a border and a
  // different shade behind the picks, and neither was there.
  //
  // The cards were emitted straight into the post body, so .hrt-art__race sat
  // outside any element carrying the design tokens — and every var(--_line),
  // var(--_paper) and var(--_sink) inside it resolved to nothing. Borders,
  // backgrounds and all. This is precisely the failure hrt.css warns about at
  // the top of its own root list, which I had read: "Miss one and every
  // var(--_line) inside it resolves to nothing, so the borders, the background
  // and the type all disappear while the component itself looks written."
  //
  // The summary block gets its own .hrt-art from the shortcode. The body needs
  // one too, and one wrapper round the lot is cheaper than registering every
  // child class as a root.
  return `<div class="hrt-art">\n${out.join("\n")}\n</div>`;
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
  // Picks first. Dan: "the selections you have here at the top."
  const PICKS_BLOCK = `<!-- wp:shortcode -->\n[hrt_article_picks heading="Every selection at a glance"]\n<!-- /wp:shortcode -->`;

  const sql = postgres(process.env.DATABASE_URL!, { max: 1, ssl: "require" });
  void PICKS_BLOCK;
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

  // The body is rendered AFTER the picks are enriched, because the race cards
  // carry the silks.
  const bodyNoH1 = body.replace(/^#\s+.*$/m, "");
  const html = `${PICKS_BLOCK}\n${renderArticle(bodyNoH1, filled)}`;

  const res = await fetch(`${site.replace(/\/$/, "")}/wp-json/hrt/v1/article`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-HRT-Token": token },
    body: JSON.stringify({
      slug, date, title, html, picks: filled,
      category: meta.category ?? "",
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
