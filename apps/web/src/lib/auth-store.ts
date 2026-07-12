import type { ThemeColorKey, UserDto } from "@bmp/types";
import { create } from "zustand";

export interface AvailableBusiness {
  businessId: string;
  businessName: string;
  businessCode: string;
  themeColor?: ThemeColorKey;
}

interface AuthState {
  accessToken: string | null;
  user: UserDto | null;
  activeBusinessId: string | null;
  availableBusinesses: AvailableBusiness[];
  isInitializing: boolean;
  setAuth: (params: {
    accessToken: string;
    user?: UserDto;
    activeBusinessId?: string;
    availableBusinesses?: AvailableBusiness[];
  }) => void;
  setUser: (user: UserDto) => void;
  updateBusinessThemeColor: (businessId: string, themeColor: ThemeColorKey) => void;
  clearAuth: () => void;
  setInitializing: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  activeBusinessId: null,
  availableBusinesses: [],
  isInitializing: true,
  setAuth: ({ accessToken, user, activeBusinessId, availableBusinesses }) =>
    set((state) => ({
      accessToken,
      user: user ?? state.user,
      activeBusinessId: activeBusinessId ?? state.activeBusinessId,
      availableBusinesses: availableBusinesses ?? state.availableBusinesses,
    })),
  setUser: (user) => set({ user }),
  updateBusinessThemeColor: (businessId, themeColor) =>
    set((state) => ({
      availableBusinesses: state.availableBusinesses.map((b) =>
        b.businessId === businessId ? { ...b, themeColor } : b,
      ),
    })),
  clearAuth: () => set({ accessToken: null, user: null, activeBusinessId: null, availableBusinesses: [] }),
  setInitializing: (value) => set({ isInitializing: value }),
}));

export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}
