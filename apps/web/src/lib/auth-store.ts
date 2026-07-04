import type { UserDto } from "@bmp/types";
import { create } from "zustand";

interface AuthState {
  accessToken: string | null;
  user: UserDto | null;
  isInitializing: boolean;
  setAuth: (params: { accessToken: string; user?: UserDto }) => void;
  setUser: (user: UserDto) => void;
  clearAuth: () => void;
  setInitializing: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  isInitializing: true,
  setAuth: ({ accessToken, user }) =>
    set((state) => ({ accessToken, user: user ?? state.user })),
  setUser: (user) => set({ user }),
  clearAuth: () => set({ accessToken: null, user: null }),
  setInitializing: (value) => set({ isInitializing: value }),
}));

export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken;
}
