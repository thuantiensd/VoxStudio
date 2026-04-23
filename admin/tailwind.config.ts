import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0a",
        surface: "#111112",
        border: "#242428",
        muted: "#71717a",
        fg: "#fafafa",
        accent: "#6c5ce7",
        "accent-hover": "#5d4dd3",
      },
      fontFamily: {
        sans: ["-apple-system", "Segoe UI", "Helvetica Neue", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
