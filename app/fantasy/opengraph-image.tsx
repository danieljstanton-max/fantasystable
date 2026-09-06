/**
 * Open Graph image for fantasystable.co.uk.
 *
 * Rendered by Next.js's built-in ImageResponse at 1200×630 — the standard
 * social-preview canvas. Facebook, WhatsApp, iMessage, Slack, Twitter all
 * pull this exact image when the URL is pasted. Kept on-brand: the same
 * turf green, the wordmark, the game's one-line pitch.
 *
 * Do NOT load an external image or webfont here — this route runs in the
 * edge runtime and cannot open sockets during render. Text uses the system
 * font stack (still crisp at this size) and the wordmark is inline SVG so
 * we ship no assets across the wire.
 */

import { ImageResponse } from "next/og";

export const alt = "Fantasy Stable — pick your horses, chase weekly bragging rights";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "edge";

export default async function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background:
            "linear-gradient(180deg, #7cc4f0 0%, #a7dbf5 45%, #6fbf6b 55%, #4c9d4c 100%)",
          fontFamily:
            "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
          color: "#17303c",
        }}
      >
        {/* Brand mark — full wordmark in SVG so no external fetch. */}
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <HorseGlyph />
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 0.95 }}>
            <span style={{ fontSize: 90, fontWeight: 900, color: "#17303c", letterSpacing: -1 }}>
              Fantasy
            </span>
            <span style={{ fontSize: 90, fontWeight: 900, color: "#0e6b31", letterSpacing: -1 }}>
              Stable
              <span style={{ fontSize: 40, color: "#7d919c", fontWeight: 800 }}>.co.uk</span>
            </span>
          </div>
        </div>

        {/* Headline on a white card — sits over the turf so it reads at
            thumbnail size, not just at full width. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 20,
            padding: "36px 44px",
            background: "rgba(255,255,255,0.96)",
            borderRadius: 32,
            boxShadow: "0 8px 30px rgba(23,48,60,0.20)",
            maxWidth: 920,
          }}
        >
          <div
            style={{
              display: "flex",
              alignSelf: "flex-start",
              padding: "6px 14px",
              borderRadius: 999,
              background: "#eaf7f0",
              color: "#04b56b",
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            Free to play · New card every Saturday
          </div>
          <div style={{ fontSize: 60, fontWeight: 900, lineHeight: 1.05, color: "#17303c" }}>
            Pick 6 horses. Choose 2 jockeys.
            <br />
            Name your NAP.{" "}
            <span style={{ color: "#04b56b" }}>Let&rsquo;s go, Champ!</span>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}

/**
 * Inline horse-head glyph — a chunky silhouette that reads at small sizes.
 * Kept simple on purpose: WhatsApp previews are ~200px wide and photographic
 * marks turn to mush at that scale.
 */
function HorseGlyph() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 130,
        height: 130,
      }}
    >
      <svg width="130" height="130" viewBox="0 0 130 130">
        <path
          fill="#8a4a29"
          d="M40 118c-3-20 3-38 15-48 4-3 5-8 3-13-3-8 0-16 6-20l8-6c3-2 7-2 9 1l3 4 12-11c3-3 8-1 9 3l4 12 12 6c11 5 18 15 18 27 0 7-3 14-8 19l-4 4c-4 4-6 8-7 14l-2 18H82l2-19c0-3-3-4-5-3l-10 8c-2 2-4 5-4 8v6H40Z"
        />
        <path fill="#3a2818" d="M40 118c0-4 0-8 1-12h20l-2 12H40Z" />
        <ellipse cx="94" cy="42" rx="3" ry="4" fill="#0f2a20" />
        <path fill="#f6f2ec" d="M76 32l4 44 6-2-3-42Z" />
      </svg>
    </div>
  );
}
