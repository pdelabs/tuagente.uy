import type { Config } from "tailwindcss";

/**
 * tuagente.uy — Material 3 "expressive"-ish system: big rounded cards, tonal
 * surface colors, a violet primary with green / coral / amber accents.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#5B4BE8",
        "primary-dark": "#3A2ED0",
        ink: "#14131F",
        "ink-soft": "#4B4A5C",
        surface: "#FBFAFF",
        // tonal card containers
        "c-violet": "#EAE6FF",
        "c-violet-ink": "#241663",
        "c-green": "#CFF3E4",
        "c-green-ink": "#0B3B2C",
        "c-coral": "#FFDFD6",
        "c-rosa": "#FBE0F0",
        "c-coral-ink": "#4A1405",
        "c-amber": "#FBEECB",
        "c-amber-ink": "#4A3608",
        "c-ink": "#161522",
      },
      borderRadius: {
        card: "2rem",
        pill: "999px",
      },
      fontFamily: {
        sans: ["var(--font-jakarta)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        soft: "0 10px 40px -12px rgba(20,19,31,0.18)",
        lift: "0 24px 60px -20px rgba(91,75,232,0.35)",
      },
      keyframes: {
        floaty: {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
      },
      animation: {
        floaty: "floaty 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
