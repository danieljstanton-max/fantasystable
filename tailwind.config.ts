import type { Config } from "tailwindcss";

/**
 * The palette lives in app/globals.css as CSS custom properties; this file only
 * exposes them to Tailwind's utility classes. Change a colour there, not here —
 * one source of truth, and the raw var() is still available for one-offs.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        surface: "var(--surface)",
        ink: "var(--ink)",
        muted: "var(--ink-muted)",
        rule: "var(--rule)",
        claret: {
          DEFAULT: "var(--claret)",
          deep: "var(--claret-deep)",
        },
        brass: {
          DEFAULT: "var(--brass)",
          light: "var(--brass-light)",
        },
        live: "var(--live)",
      },
      fontFamily: {
        display: ["var(--font-display)"],
        body: ["var(--font-body)"],
        data: ["var(--font-data)"],
      },
    },
  },
  plugins: [],
};

export default config;
