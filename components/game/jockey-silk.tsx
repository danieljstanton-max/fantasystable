/**
 * A jockey's game colours.
 *
 * Jockeys have no silks of their own — they wear the owner's, so their real
 * colours change every ride. The game gives each rider a set of colours of its
 * own and keeps them, so players can learn to spot "the purple hoops" the way
 * they learn a real owner's colours.
 *
 * We render through The Racing API's silk generator — the same service that
 * draws the horse silks on the pitch — so the bench and the pitch look like
 * they come from one place. Parameters (patterns + colours) are derived from
 * the jockey id, so a rider is the same silk every time with nothing to store.
 */

/** The palette The Racing API's silk endpoint understands, verbatim. */
const COLOURS = [
  "royalblue",
  "darkblue",
  "lightblue",
  "red",
  "maroon",
  "yellow",
  "gold",
  "orange",
  "pink",
  "emeraldgreen",
  "darkgreen",
  "mauve",
  "black",
  "grey",
] as const;

const BODY_PATTERNS = [
  "solid",
  "stripe",
  "hoops",
  "quartered",
  "sash",
  "star",
  "disc",
  "diabolo",
  "chevrons-dual",
  "epaulettes",
  "seams",
  "spots",
  "diamond",
] as const;

const CAP_PATTERNS = ["solid", "hoops", "star", "diamond", "quartered"] as const;

/** FNV-1a, stable across runtimes; only used to bucket a string id. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Deterministic silk URL for a jockey id.
 *
 * Body pattern always uses two colours so the silk reads as distinct rather
 * than a solid block; cap picks its own two so cap and body aren't a set.
 */
export function jockeySilkUrl(id: string): string {
  const h = hash(id);
  const c = (offset: number) => COLOURS[(h >>> offset) % COLOURS.length];
  const body = BODY_PATTERNS[h % BODY_PATTERNS.length];
  const cap = CAP_PATTERNS[(h >>> 5) % CAP_PATTERNS.length];
  const bodyA = c(0);
  const bodyB = c(8);
  const sleeve = c(12);
  const capA = c(16);
  const capB = c(20);
  const url = new URL("https://silks.theracingapi.com/silk");
  url.searchParams.set("body", bodyA === bodyB ? `solid:${bodyA}` : `${body}:${bodyA},${bodyB}`);
  url.searchParams.set("sleeves", `solid:${sleeve}`);
  url.searchParams.set("cap", capA === capB ? `solid:${capA}` : `${cap}:${capA},${capB}`);
  return url.toString();
}

export function JockeySilk({ id, size = 72 }: { id: string; size?: number }) {
  const src = jockeySilkUrl(id);
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="max-h-full max-w-full object-contain drop-shadow-[0_2px_3px_rgba(0,0,0,0.25)]"
    />
  );
}
