import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [path.join(__dirname, "src/**/*.{ts,tsx}")],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "#0d1117",
        surface: "#161b22",
        border: "#30363d",
        "text-primary": "#e6edf3",
        "text-secondary": "#8b949e",
        accent: "#58a6ff",
        added: "#2ea04370",
        deleted: "#f8514970",
      },
    },
  },
  plugins: [],
};
