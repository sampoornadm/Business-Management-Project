import type { AssistantFilterChipDto, AssistantQueryResultDto, AssistantQueryState } from "@bmp/types";
import { create } from "zustand";

import { useAuthStore } from "./auth-store";

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  results?: AssistantQueryResultDto["results"];
  filters?: AssistantFilterChipDto[];
}

interface AssistantChatState {
  open: boolean;
  /** Unsent draft, kept so closing the panel does not eat half-typed text. */
  input: string;
  messages: AssistantMessage[];
  /** The structured query behind the last answer; echoed to the server so follow-ups refine it. */
  queryState: AssistantQueryState | null;
  setOpen: (open: boolean) => void;
  setInput: (input: string) => void;
  addMessage: (message: AssistantMessage) => void;
  setQueryState: (state: AssistantQueryState | null) => void;
  /** "New chat": drops the conversation and its context; the panel stays open. */
  newChat: () => void;
  /** Sign-out / different user or business: drops everything, including the open state. */
  resetAll: () => void;
}

const empty = (): Pick<AssistantChatState, "input" | "messages" | "queryState"> => ({
  input: "",
  messages: [],
  queryState: null,
});

/**
 * The conversation lives in module memory: it survives navigating between pages and
 * closing/reopening the panel, and disappears on a full page reload — deliberately not persisted.
 */
export const useAssistantStore = create<AssistantChatState>((set) => ({
  open: false,
  ...empty(),
  setOpen: (open) => set({ open }),
  setInput: (input) => set({ input }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  setQueryState: (queryState) => set({ queryState }),
  newChat: () => set(empty()),
  resetAll: () => set({ open: false, ...empty() }),
}));

// A conversation belongs to one user in one business. Its answers are links into that business's
// records, and switching business here is a client-side state change (no reload), so without this a
// stale chat would survive logout, a different login, or a business switch. Token refreshes keep the
// same user and business, so they leave the chat alone.
useAuthStore.subscribe((state, prev) => {
  if (state.user?.id !== prev.user?.id || state.activeBusinessId !== prev.activeBusinessId) {
    useAssistantStore.getState().resetAll();
  }
});
