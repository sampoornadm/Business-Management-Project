"use client";

import type { ContactDto } from "@bmp/types";
import { Input } from "@bmp/ui";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";

import { filterContacts } from "@/lib/contact-search";

export interface ContactSearchBarProps {
  contacts: ContactDto[];
  onFilteredChange: (filtered: ContactDto[]) => void;
}

export function ContactSearchBar({ contacts, onFilteredChange }: ContactSearchBarProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    onFilteredChange(filterContacts(query, contacts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, contacts]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search contacts by name, department, or designation..."
        className="pl-9"
      />
    </div>
  );
}
