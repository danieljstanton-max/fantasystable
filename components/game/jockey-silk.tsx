/**
 * A jockey's game colours.
 *
 * Jockeys have no silks of their own — they wear the owner's, so they are in
 * different colours every ride. Borrowing the silk from one of their rides
 * would be actively misleading, so the game gives each rider a set of colours
 * of its own and keeps them.
 *
 * Derived from the jockey's id, so the same rider is the same colours on every
 * card, forever, with no table to store and no assets to ship. Players learn to
 * spot "the purple hoops" the way they learn a real owner's colours, and that
 * recognition is most of what the bench is for.
 *
 * Drawn inline rather than fetched. Two per card is not worth a round trip, and
 * an SVG stays sharp on a phone.
 */

/** Racing's own vocabulary, not a generic UI ramp. Each pairs on white or black. */
const COLOURS = [
  "#1b3fae", // royal blue
  "#c8102e", // scarlet
  "#f2c200", // gold
  "#0f7a3d", // emerald
  "#5b2a86", // purple
  "#111111", // black
  "#e8681c", // orange
  "#7a1230", // maroon
  "#5fbfe0", // light blue
  "#e46aa7", // pink
  "#f5f2ec", // white
  "#0d5c63", // teal
];

type Pattern = "solid" | "stripes" | "hoops" | "quartered" | "sash" | "spots" | "chevron" | "star";

const PATTERNS: Pattern[] = [
  "solid",
  "stripes",
  "hoops",
  "quartered",
  "sash",
  "spots",
  "chevron",
  "star",
];

/** FNV-1a. Small, stable across runtimes, and good enough to spread ids out. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function silkColours(id: string) {
  const h = hash(id);
  const base = COLOURS[h % COLOURS.length];
  // Offset the second pick by a coprime step so base and trim never collide.
  const trim = COLOURS[(Math.floor(h / COLOURS.length) * 5 + 7) % COLOURS.length];
  const pattern = PATTERNS[Math.floor(h / 97) % PATTERNS.length];
  const capBase = (h >> 3) % 2 === 0 ? base : trim;
  const capTrim = capBase === base ? trim : base;
  return {
    base,
    trim: trim === base ? COLOURS[(COLOURS.indexOf(base) + 5) % COLOURS.length] : trim,
    pattern,
    capBase,
    capTrim,
  };
}

export function JockeySilk({ id, size = 48 }: { id: string; size?: number }) {
  const { base, trim, pattern, capBase, capTrim } = silkColours(id);
  const clip = `silk-${hash(id).toString(36)}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden
      className="drop-shadow-sm"
      role="presentation"
    >
      <defs>
        {/* The jersey: shoulders, sleeves and a straight hem. */}
        <clipPath id={clip}>
          <path d="M22 22c0-4 4.5-7 10-7s10 3 10 7v24a2 2 0 0 1-2 2H24a2 2 0 0 1-2-2V22Z" />
        </clipPath>
      </defs>

      {/* Cap */}
      <g>
        <path d="M25 12a7 7 0 0 1 14 0v2H25v-2Z" fill={capBase} />
        <path d="M39 13.5h5a1.5 1.5 0 0 1 0 3h-5v-3Z" fill={capTrim} />
        {capBase !== capTrim && <path d="M32 5.2a7 7 0 0 1 7 6.8h-7V5.2Z" fill={capTrim} />}
      </g>

      {/* Sleeves sit under the body so the shoulder line stays clean. */}
      <path d="M22 23c-4 1-7 3.5-8.5 7l-1 2.5 7 3 4-8V23Z" fill={trim} />
      <path d="M42 23c4 1 7 3.5 8.5 7l1 2.5-7 3-4-8V23Z" fill={trim} />

      {/* Body */}
      <g clipPath={`url(#${clip})`}>
        <rect x="18" y="10" width="28" height="42" fill={base} />

        {pattern === "stripes" &&
          [0, 1, 2, 3].map((i) => (
            <rect key={i} x={22 + i * 5.5} y="10" width="2.6" height="42" fill={trim} />
          ))}

        {pattern === "hoops" &&
          [0, 1, 2, 3].map((i) => (
            <rect key={i} x="18" y={20 + i * 8} width="28" height="4" fill={trim} />
          ))}

        {pattern === "quartered" && (
          <>
            <rect x="32" y="10" width="14" height="21" fill={trim} />
            <rect x="18" y="31" width="14" height="21" fill={trim} />
          </>
        )}

        {pattern === "sash" && <path d="M14 46 44 8l7 5-30 38-7-5Z" fill={trim} />}

        {pattern === "chevron" && (
          <>
            <path d="M18 30l14-9 14 9-14 9-14-9Z" fill={trim} />
            <path d="M18 44l14-9 14 9-14 9-14-9Z" fill={trim} />
          </>
        )}

        {pattern === "spots" &&
          [
            [26, 24],
            [38, 24],
            [32, 33],
            [26, 42],
            [38, 42],
          ].map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="3.4" fill={trim} />)}

        {pattern === "star" && (
          <path
            d="M32 20l3.4 7.4 8 1.2-5.8 5.6 1.4 8-7-3.9-7 3.9 1.4-8-5.8-5.6 8-1.2L32 20Z"
            fill={trim}
          />
        )}
      </g>

      {/* Outline last, so every colour combination keeps a readable edge. */}
      <path
        d="M22 22c0-4 4.5-7 10-7s10 3 10 7v24a2 2 0 0 1-2 2H24a2 2 0 0 1-2-2V22Z"
        fill="none"
        stroke="rgba(0,0,0,0.28)"
        strokeWidth="1.2"
      />
    </svg>
  );
}
