import basePreset from "@bmp/config/tailwind/preset";
import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  presets: [basePreset],
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
};

export default config;
