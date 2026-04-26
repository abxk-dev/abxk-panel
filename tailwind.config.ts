import type { Config } from "tailwindcss"

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#1a1a1a",
        brand: "#D4A017"
      }
    }
  },
  plugins: []
}

export default config
