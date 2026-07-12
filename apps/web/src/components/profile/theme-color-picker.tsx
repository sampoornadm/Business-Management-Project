"use client";

import type { ThemeColorKey } from "@bmp/types";
import { Button, useToast } from "@bmp/ui";
import { Check } from "lucide-react";
import { useTheme } from "next-themes";

import { useUpdateThemeColor } from "@/hooks/use-users";
import { THEME_COLOR_KEYS, THEME_COLORS } from "@/lib/theme-colors";

interface ThemeColorPickerProps {
  businessId: string;
  businessName: string;
  activeColor: ThemeColorKey;
}

export function ThemeColorPicker({ businessId, businessName, activeColor }: ThemeColorPickerProps) {
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const updateThemeColor = useUpdateThemeColor();
  const mode = resolvedTheme === "dark" ? "dark" : "light";

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{businessName}</p>
      <div className="flex flex-wrap gap-2">
        {THEME_COLOR_KEYS.map((key) => {
          const vars = THEME_COLORS[key][mode];
          const isActive = key === activeColor;
          return (
            <Button
              key={key}
              type="button"
              variant="outline"
              size="icon"
              aria-label={key}
              aria-pressed={isActive}
              disabled={updateThemeColor.isPending}
              className="h-8 w-8 rounded-full border-2 p-0"
              style={{
                backgroundColor: `hsl(${vars.primary})`,
                borderColor: isActive ? `hsl(${vars.primary})` : "transparent",
              }}
              onClick={async () => {
                try {
                  await updateThemeColor.mutateAsync({ businessId, themeColor: key });
                } catch (error) {
                  toast({
                    variant: "destructive",
                    title: "Could not update theme color",
                    description: error instanceof Error ? error.message : "Please try again.",
                  });
                }
              }}
            >
              {isActive && <Check className="h-4 w-4" style={{ color: `hsl(${vars.primaryForeground})` }} />}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
