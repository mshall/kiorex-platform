import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";
import kxPreset from "./src/brand/tailwind-preset.cjs";

const hsl = (v: string) => `hsl(var(--${v}) / <alpha-value>)`;

export default {
  presets: [kxPreset],
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem", screens: { "2xl": "1200px" } },
    extend: {
      fontFamily: {
        sans: ["var(--kx-font)"],
        arabic: ["var(--kx-font-ar)"],
      },
      colors: {
        border: hsl("border"),
        input: hsl("input"),
        ring: hsl("ring"),
        background: hsl("background"),
        foreground: hsl("foreground"),
        primary: { DEFAULT: hsl("primary"), foreground: hsl("primary-foreground") },
        secondary: { DEFAULT: hsl("secondary"), foreground: hsl("secondary-foreground") },
        destructive: { DEFAULT: hsl("destructive"), foreground: hsl("destructive-foreground") },
        muted: { DEFAULT: hsl("muted"), foreground: hsl("muted-foreground") },
        accent: { DEFAULT: hsl("accent"), foreground: hsl("accent-foreground") },
        popover: { DEFAULT: hsl("popover"), foreground: hsl("popover-foreground") },
        card: { DEFAULT: hsl("card"), foreground: hsl("card-foreground") },
        pulse: { DEFAULT: hsl("pulse"), foreground: hsl("pulse-foreground") },
        ocean: hsl("ocean"),
        success: { DEFAULT: hsl("success"), soft: hsl("success-soft") },
        warning: { DEFAULT: hsl("warning"), soft: hsl("warning-soft") },
        info: { DEFAULT: hsl("info"), soft: hsl("info-soft") },
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 4px)", sm: "calc(var(--radius) - 8px)", xl: "var(--radius)", "2xl": "calc(var(--radius) + 6px)" },
      boxShadow: { card: "var(--kx-shadow-1)", raised: "var(--kx-shadow-2)", float: "var(--kx-shadow-3)", overlay: "var(--kx-shadow-4)" },
      minHeight: { 11: "2.75rem", 12: "3rem" },
      minWidth: { 11: "2.75rem" },
      keyframes: { pulseline: { "0%": { strokeDashoffset: "200" }, "100%": { strokeDashoffset: "0" } } },
      animation: { pulseline: "pulseline 1.6s ease-in-out infinite" },
    },
  },
  plugins: [animate],
} satisfies Config;
