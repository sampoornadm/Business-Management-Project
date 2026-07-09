import { useEffect } from "react";
import { create } from "zustand";

interface BreadcrumbState {
  labels: Record<string, string>;
  setLabel: (segment: string, label: string) => void;
  clearLabel: (segment: string) => void;
}

export const useBreadcrumbStore = create<BreadcrumbState>((set) => ({
  labels: {},
  setLabel: (segment, label) =>
    set((state) => ({ labels: { ...state.labels, [segment]: label } })),
  clearLabel: (segment) =>
    set((state) => {
      const { [segment]: _removed, ...labels } = state.labels;
      return { labels };
    }),
}));

/** Registers a display label for a dynamic route segment (e.g. an entity id) so
 * `Breadcrumbs` can show it instead of the raw segment. Clears on unmount so a
 * stale label doesn't leak into the next page that reuses the same id. */
export function useBreadcrumbLabel(segment: string | undefined, label: string | undefined) {
  const setLabel = useBreadcrumbStore((state) => state.setLabel);
  const clearLabel = useBreadcrumbStore((state) => state.clearLabel);

  useEffect(() => {
    if (!segment || !label) return;
    setLabel(segment, label);
    return () => clearLabel(segment);
  }, [segment, label, setLabel, clearLabel]);
}
