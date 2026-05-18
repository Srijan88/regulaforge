import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: "#0b1326",
          dim: "#0b1326",
          bright: "#31394d",
          lowest: "#060e20",
          low: "#131b2e",
          mid: "#1b2339",
          high: "#252d43",
          highest: "#31394d",
        },
        primary: {
          DEFAULT: "#2e72d2",
          container: "#004494",
        },
        accent: {
          green: "#00ff9d",
          orange: "#ffaa00",
          cyan: "#4fd8eb",
        },
        on: {
          surface: "#e2e2e6",
          "surface-variant": "#c4c6d0",
        },
        outline: {
          DEFAULT: "#8e9099",
          variant: "#44474f",
        },
      },
      fontFamily: {
        mono: ["Fira Code", "JetBrains Mono", "monospace"],
      },
      borderRadius: {
        DEFAULT: "4px",
      },
    },
  },
  plugins: [],
};

export default config;
