import type { AssistantQueryState, UserDto } from "@bmp/types";
import { beforeEach, describe, expect, it } from "vitest";

import { useAssistantStore } from "./assistant-store";
import { useAuthStore } from "./auth-store";

const state: AssistantQueryState = {
  entity: "tender",
  itemTerms: ["washer"],
  statuses: [],
  dateField: "quoted",
  dateRange: null,
  partyText: null,
};
const user = (id: string) => ({ id }) as UserDto;

function fillChat() {
  const chat = useAssistantStore.getState();
  chat.setOpen(true);
  chat.setInput("half-typed");
  chat.addMessage({ id: "1", role: "user", text: "tenders for washers" });
  chat.addMessage({ id: "2", role: "assistant", text: "Found 2 tenders.", results: [], filters: [] });
  chat.setQueryState(state);
}

describe("assistant store", () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, activeBusinessId: null, accessToken: null });
    useAssistantStore.getState().resetAll();
    useAuthStore.getState().setAuth({ accessToken: "t1", user: user("u1"), activeBusinessId: "b1" });
    useAssistantStore.getState().resetAll();
  });

  it("holds messages, the draft, the open state and the query context", () => {
    fillChat();
    const chat = useAssistantStore.getState();
    expect(chat.open).toBe(true);
    expect(chat.input).toBe("half-typed");
    expect(chat.messages.map((m) => m.id)).toEqual(["1", "2"]);
    expect(chat.queryState).toEqual(state);
  });

  it("'New chat' drops the conversation and context but keeps the panel open", () => {
    fillChat();
    useAssistantStore.getState().newChat();
    const chat = useAssistantStore.getState();
    expect(chat).toMatchObject({ open: true, input: "", messages: [], queryState: null });
  });

  it("survives a token refresh for the same user and business", () => {
    fillChat();
    useAuthStore.getState().setAuth({ accessToken: "t2", user: user("u1"), activeBusinessId: "b1" });
    expect(useAssistantStore.getState().messages).toHaveLength(2);
    expect(useAssistantStore.getState().queryState).toEqual(state);
  });

  it("is dropped on logout", () => {
    fillChat();
    useAuthStore.getState().clearAuth();
    expect(useAssistantStore.getState()).toMatchObject({ open: false, input: "", messages: [], queryState: null });
  });

  it("is dropped when a different user signs in without a page reload", () => {
    fillChat();
    useAuthStore.getState().setAuth({ accessToken: "t3", user: user("u2"), activeBusinessId: "b1" });
    expect(useAssistantStore.getState().messages).toEqual([]);
  });

  it("is dropped when the active business is switched", () => {
    fillChat();
    useAuthStore.getState().setAuth({ accessToken: "t4", activeBusinessId: "b2" });
    expect(useAssistantStore.getState()).toMatchObject({ messages: [], queryState: null });
  });
});
