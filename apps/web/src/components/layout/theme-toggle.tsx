"use client";

import { Button } from "@bmp/ui";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

type ThemeOption = "light" | "dark" | "system";

const THEME_ICON = { light: Sun, dark: Moon, system: Monitor };
const THEME_LABEL = { light: "Light", dark: "Dark", system: "System" };
const NEXT_THEME: Record<ThemeOption, ThemeOption> = { light: "dark", dark: "system", system: "light" };

function nextTheme(current: ThemeOption): ThemeOption {
  return NEXT_THEME[current];
}

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // `theme` is undefined until next-themes reads localStorage on mount — render
  // a neutral placeholder until then so the icon doesn't flash/mismatch on hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const current = mounted ? ((theme as ThemeOption) ?? "system") : "system";
  const Icon = THEME_ICON[current];

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(nextTheme(current))}
      aria-label={`Theme: ${THEME_LABEL[current]}. Click to switch to ${THEME_LABEL[nextTheme(current)]}.`}
      title={`Theme: ${THEME_LABEL[current]}`}
    >
      {mounted && <Icon className="h-5 w-5" />}
    </Button>
  );
}
