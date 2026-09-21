"use client";

import type { AssistantFilterChipDto, AssistantQueryInput } from "@bmp/types";
import { Button, Input, useToast } from "@bmp/ui";
import { Bot, Loader2, Send, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { SearchResultList } from "@/components/search/search-result-list";
import { useAssistantQuery } from "@/hooks/use-assistant";
import { useAssistantStore } from "@/lib/assistant-store";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

const EXAMPLES = [
  "tenders I quoted last month for washers",
  "RFQs sent this year for cable glands",
  "bills for PVC conduit in August",
];

// Floating chat widget, replaces the old standalone /assistant page and nav link. The conversation
// lives in useAssistantStore, so it survives navigating to a result and closing/reopening the panel;
// it is dropped by "New chat", a page reload, sign-out, or switching business.
export function AssistantWidget() {
  const roleName = useAuthStore((state) => state.user?.role.name);
  const { toast } = useToast();
  const assistantQuery = useAssistantQuery();
  const { open, input, messages, queryState } = useAssistantStore();
  const { setOpen, setInput, addMessage, setQueryState, newChat } = useAssistantStore.getState();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, assistantQuery.isPending, open]);

  if (!hasPermission(roleName, "reports:read")) return null;

  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;

  async function submit(request: AssistantQueryInput, userText: string) {
    const userMessageId = crypto.randomUUID();
    addMessage({ id: userMessageId, role: "user", text: userText });
    try {
      const result = await assistantQuery.mutateAsync(request);
      // The chat may have been dropped while this was in flight (sign-out, business switch): a late
      // answer must not resurrect it.
      if (!useAssistantStore.getState().messages.some((m) => m.id === userMessageId)) return;
      setQueryState(result.state);
      addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        text: result.reply,
        results: result.results,
        filters: result.filters,
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Assistant error",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleSend(message = input) {
    const text = message.trim();
    if (!text || assistantQuery.isPending) return;
    setInput("");
    // Read the latest context at send time: a follow-up must refine the previous answer.
    await submit({ message: text, state: useAssistantStore.getState().queryState }, text);
  }

  async function handleRemoveFilter(chip: AssistantFilterChipDto) {
    const current = useAssistantStore.getState().queryState;
    if (!current || assistantQuery.isPending) return;
    await submit({ state: current, removeFilter: chip.key }, `Remove filter: ${chip.label}`);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open assistant"
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 active:scale-95"
      >
        <Bot className="h-6 w-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex h-[36rem] w-[26rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
      <div className="flex items-center justify-between border-b bg-primary px-4 py-3 text-primary-foreground">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          <span className="text-sm font-semibold">Assistant</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close assistant"
          className="rounded p-1 hover:bg-primary-foreground/20"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-medium">What I can do</p>
              <ul className="list-disc space-y-1 pl-4 text-xs text-muted-foreground">
                <li>
                  Find tenders, RFQs, purchase orders and bills by item, status, client or vendor, and date — for
                  example which tenders you quoted last month.
                </li>
                <li>
                  Narrow it down with follow-ups: &quot;the ones I won&quot;, &quot;also gaskets&quot;, &quot;only
                  this quarter&quot;, &quot;remove the won filter&quot;.
                </li>
                <li>Look up a tender or its documents by tender number.</li>
              </ul>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Try one:</p>
              <div className="flex flex-col items-start gap-1">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => void handleSend(example)}
                    className="rounded-full border px-3 py-1 text-left text-xs hover:bg-muted"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className="max-w-[92%]">
              <div
                className={
                  message.role === "user"
                    ? "rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                    : "rounded-lg bg-muted px-3 py-2 text-sm"
                }
              >
                {message.text}
              </div>
              {message.filters && message.filters.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1" aria-label="Active filters">
                  {message.filters.map((chip) =>
                    message.id === lastAssistantId ? (
                      <button
                        key={chip.key}
                        type="button"
                        onClick={() => void handleRemoveFilter(chip)}
                        disabled={assistantQuery.isPending}
                        aria-label={`Remove filter ${chip.label}`}
                        className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50"
                      >
                        {chip.label}
                        <X className="h-3 w-3 text-muted-foreground" />
                      </button>
                    ) : (
                      <span key={chip.key} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                        {chip.label}
                      </span>
                    ),
                  )}
                </div>
              )}
              {message.results && message.results.length > 0 && (
                <div className="mt-2">
                  <SearchResultList results={message.results} />
                </div>
              )}
            </div>
          </div>
        ))}
        {assistantQuery.isPending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Searching…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 border-t p-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSend();
          }}
          placeholder={queryState ? "Refine — e.g. the ones I won" : "Tenders I quoted last month for washers…"}
          disabled={assistantQuery.isPending}
          autoFocus
        />
        <Button size="icon" onClick={() => void handleSend()} disabled={assistantQuery.isPending} aria-label="Send">
          <Send className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2 border-t bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>Chat and context are kept until you start a new chat, refresh, or sign out.</span>
        {(messages.length > 0 || queryState) && (
          <button
            type="button"
            onClick={newChat}
            disabled={assistantQuery.isPending}
            className="shrink-0 font-medium underline underline-offset-2 hover:text-foreground disabled:opacity-50"
          >
            New chat
          </button>
        )}
      </div>
    </div>
  );
}
