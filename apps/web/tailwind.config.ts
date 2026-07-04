import type { Config } from "tailwindcss";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const basePreset = require("@bmp/config/tailwind/preset");

const config: Config = {
  darkMode: ["class"],
  presets: [basePreset],
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
};

export default config;
