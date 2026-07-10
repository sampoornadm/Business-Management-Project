import type { UserDto } from "@bmp/types";
import { create } from "zustand";

export interface AvailableBusiness {
  businessId: string;
  businessName: string;
  businessCode: string;
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
  clearAuth: () => set({ accessToken: null, user: null, activeBusinessId: null, availableBusinesses: [] }),
  setInitializing: (value) => set({ isInitializing: value }),
}));

export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}
