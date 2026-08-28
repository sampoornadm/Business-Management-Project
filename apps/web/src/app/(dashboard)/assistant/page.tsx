"use client";

import type { AssistantQueryResultDto } from "@bmp/types";
import { Button, Input, useToast } from "@bmp/ui";
import { Send } from "lucide-react";
import { useState } from "react";

import { SearchResultList } from "@/components/search/search-result-list";
import { useAssistantQuery } from "@/hooks/use-assistant";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  results?: AssistantQueryResultDto["results"];
}

export default function AssistantPage() {
  const { toast } = useToast();
  const assistantQuery = useAssistantQuery();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);

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

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Assistant</h1>
        <p className="text-sm text-muted-foreground">
          Ask for a document in plain language — e.g. &quot;find the bill for tender TND-2026-001&quot;.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "self-end" : "self-start"}>
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
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSend();
          }}
          placeholder="Find the bill for tender..."
          disabled={assistantQuery.isPending}
        />
        <Button onClick={() => void handleSend()} disabled={assistantQuery.isPending}>
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
