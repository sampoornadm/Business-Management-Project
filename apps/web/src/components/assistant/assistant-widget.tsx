"use client";

import type { AssistantQueryResultDto } from "@bmp/types";
import { Button, Input, useToast } from "@bmp/ui";
import { Bot, Send, X } from "lucide-react";
import { useState } from "react";

import { SearchResultList } from "@/components/search/search-result-list";
import { useAssistantQuery } from "@/hooks/use-assistant";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  results?: AssistantQueryResultDto["results"];
}

// Floating chat widget, replaces the old standalone /assistant page and nav link.
export function AssistantWidget() {
  const roleName = useAuthStore((state) => state.user?.role.name);
  const { toast } = useToast();
  const assistantQuery = useAssistantQuery();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);

  if (!hasPermission(roleName, "reports:read")) return null;

  async function handleSend() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text }]);

    try {
      const result = await assistantQuery.mutateAsync(text);
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", text: result.reply, results: result.results },
      ]);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Assistant error",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
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
    <div className="fixed bottom-6 right-6 z-50 flex h-[32rem] w-96 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl">
      <div className="flex items-center justify-between border-b bg-primary px-4 py-3 text-primary-foreground">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          <span className="text-sm font-semibold">Assistant</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close assistant"
          className="rounded p-0.5 hover:bg-primary-foreground/20"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Ask for a document in plain language — e.g. &quot;find the bill for tender
            TND-2026-001&quot;.
          </p>
        )}
        {messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className="max-w-[85%]">
              <div
                className={
                  message.role === "user"
                    ? "rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                    : "rounded-lg bg-muted px-3 py-2 text-sm"
                }
              >
                {message.text}
              </div>
              {message.results && message.results.length > 0 && (
                <div className="mt-2">
                  <SearchResultList results={message.results} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 border-t p-3">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSend();
          }}
          placeholder="Find the bill for tender..."
          disabled={assistantQuery.isPending}
          autoFocus
        />
        <Button size="icon" onClick={() => void handleSend()} disabled={assistantQuery.isPending}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
