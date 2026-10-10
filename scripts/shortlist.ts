/**
 * The shortlist: the method, applied to the whole card, every day.
 *
 *   npm run shortlist -- 2026-10-10
 *   npm run shortlist -- 2026-10-10 --max-field=13 --max-price=21
 *
 * Dan, 2026-10-10: "you should be doing this anyway." He is right, and that is
 * the point of this file existing rather than me running the query when asked.
 *
 * Four conditions, all of them his, none of them new:
 *
 *   1. In below the mark it last won off, in the same code, read from the
 *      WEIGHTS — `ofr` goes stale the moment a horse is reassessed for a win.
 *   2. Has actually WON on today's going. The ground rule only ever removes a
 *      horse; this asks for positive evidence instead. On 10 October it is what
 *      separated VOLENTI (4 wins from 26 on standard) from APACHE OUTLAW (26lb
 *      well in, 0 wins from 5 on soft) — which I had top of the list twice.
 *   3. Under 13 runners. Our picks in bigger fields lose across both test
 *      windows.
 *   4. A price the market can live with. A horse 26lb well in at 66/1 is a
 *      horse the handicapper has given up on and the market agrees.
 *
 * Ranked by pounds well in plus three per win on the going, so a solid ground
 * record outweighs a spectacular drop nobody believes in.
 *
 * It is a shortlist, not a card. It has had no draw, pace or trip work done on
 * it, and two horses from the same race can both appear — that is for whoever
 * reads it to resolve.
 */
import "dotenv/config";
import postgres from "postgres";
import { groundGate, sameDiscipline } from "../lib/selection";
import { hasProvenWin, provingBands } from "../lib/going-scale";
import { readMark } from "../lib/marks";
const argDate = process.argv[2];
const MAX_FIELD = Number((process.argv.find((a) => a.startsWith("--max-field=")) ?? "").split("=")[1] ?? 13);
const MAX_PRICE = Number((process.argv.find((a) => a.startsWith("--max-price=")) ?? "").split("=")[1] ?? 21);
/** Horses already on the card, named so the shortlist is what we have NOT got. */
const HAVE = new Set(
  (process.argv.find((a) => a.startsWith("--have=")) ?? "").split("=")[1]
    ?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) ?? []
);
async function main(){
 if (!argDate || !/^\d{4}-\d{2}-\d{2}$/.test(argDate)) {
   console.error("usage: npm run shortlist -- YYYY-MM-DD [--max-field=13] [--max-price=21] [--have=A,B]");
   process.exit(1);
 }
 const sql=postgres(process.env.DATABASE_URL!,{max:1,ssl:"require"});
 const races=await sql<any[]>`
   SELECT ra.id, ra.off_time, ra.name, ra.race_type, ra.going_band, ra.distance_f,
          ra.race_class, ra.field_size, c.name course
   FROM races ra LEFT JOIN courses c ON c.id=ra.course_id
   WHERE ra.race_date=${argDate} AND ra.field_size < ${MAX_FIELD}
     AND EXISTS (SELECT 1 FROM runners n WHERE n.race_id=ra.id AND n.number IS NOT NULL)
   ORDER BY ra.off_time`;
 type Hit={off:string;course:string;name:string;price:string;dec:number;wellIn:number;
   gw:number;gp:number;gn:number;field:number;cls:string;going:string;dist:number;hcap:boolean;last:string};
 const hits:Hit[]=[];
 for(const ra of races){
  const field=await sql<any[]>`SELECT horse_id, horse_name, ofr, weight_lbs, jockey_claim_lbs claim,
    best_odds_frac, best_odds_dec, form FROM runners WHERE race_id=${ra.id} AND NOT is_non_runner`;
  const shape=(r:any)=>({ofr:r.ofr,weightLbs:r.weight_lbs,claim:r.claim});
  const fs=field.map(shape);
  for(const r of field){
   if(HAVE.has(String(r.horse_name).toUpperCase())) continue;
   if(!r.best_odds_dec || Number(r.best_odds_dec) > MAX_PRICE) continue;      // market has to be with us
   const mk=readMark(fs,shape(r)); const mark=mk.effective??mk.published;
   if(mark===null) continue;
   const hist=await sql<any[]>`
     SELECT ra2.going_band "goingBand", ru.position_num "positionNum", ru.ofr, ru.position,
            ra2.race_type "raceType", ra2.race_date "raceDate", ra2.distance_f "distanceF",
            ra2.course_slug "courseSlug", ru.ovr_btn "ovrBtn", ru.comment, ru.age,
            ra2.field_size "fieldSize", ru.jockey_id "jockeyId", NULL "winMargin"
     FROM runners ru JOIN races ra2 ON ra2.id=ru.race_id
     WHERE ru.horse_id=${r.horse_id} AND ra2.race_date<${argDate} AND ru.position_num IS NOT NULL
     ORDER BY ra2.race_date DESC`;
   const code=hist.filter(x=>sameDiscipline(x.raceType,ra.race_type));
   const win=code.find(x=>Number(x.positionNum)===1 && x.ofr!==null);
   if(!win) continue;
   const wellIn=Number(win.ofr)-mark;
   if(wellIn<=0) continue;                                            // must be in below its mark
   if(groundGate(hist as any, ra.going_band)) continue;
   // Won on ground that PROVES today's, not merely on today's exact band.
   // A win on heavy proves soft; see lib/going-scale.ts.
   if(!hasProvenWin(code as any, ra.going_band)) continue;
   const proving = new Set(provingBands(ra.going_band));
   const on=code.filter(x=>proving.has(String(x.goingBand)));
   const gw=on.filter(x=>Number(x.positionNum)===1).length;
   hits.push({off:String(ra.off_time),course:String(ra.course).replace(/-AW$/,""),
     name:String(r.horse_name),price:String(r.best_odds_frac),dec:Number(r.best_odds_dec),
     wellIn,gw,gp:on.filter(x=>[2,3].includes(Number(x.positionNum))).length,gn:on.length,
     field:Number(ra.field_size),cls:String(ra.race_class??"?"),going:String(ra.going_band),
     dist:Number(ra.distance_f),hcap:/handicap/i.test(String(ra.name)),last:String(r.form??"")});
  }
 }
 hits.sort((a,b)=> (b.wellIn+b.gw*3) - (a.wellIn+a.gw*3));
 console.log(`\nSHORTLIST — ${argDate}\n${"=".repeat(74)}`);
 console.log(`  in below its winning mark · has won on today's going · under ${MAX_FIELD} runners · ${MAX_PRICE - 1}/1 or shorter`);
 console.log(`  ${hits.length} qualify\n`);
 for(const h of hits) console.log(
  `  ${h.off} ${h.course.padEnd(12)} ${h.name.toUpperCase().padEnd(19)} ${h.price.padEnd(6)} ` +
  `${String(h.wellIn).padStart(2)}lb in · ${h.gw}w ${h.gp}p from ${h.gn} on ${h.going} or softer\n` +
  `      ${h.dist}f ${h.cls} · ${h.field} runners${h.hcap?"":" · NOT a handicap"} · form ${h.last}`);
 await sql.end();}
main().catch(e=>{console.error(e?.message??e);process.exit(1);});
