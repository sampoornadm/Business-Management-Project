"use client";

import type { ContactDto } from "@bmp/types";
import { Input } from "@bmp/ui";
import fuzzysort from "fuzzysort";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";

export interface ContactSearchBarProps {
  contacts: ContactDto[];
  onFilteredChange: (filtered: ContactDto[]) => void;
}

interface SearchableContact {
  contact: ContactDto;
  name: string;
  department: string;
  designation: string;
}

export function ContactSearchBar({ contacts, onFilteredChange }: ContactSearchBarProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!query.trim()) {
      onFilteredChange(contacts);
      return;
    }

    const searchable: SearchableContact[] = contacts.map((contact) => ({
      contact,
      name: contact.name,
      department: contact.department ?? "",
      designation: contact.designation ?? "",
    }));

    // threshold: 0 = any match (fuzzysort v4 scores 0-1; the default .5 only
    // returns "good" matches, too strict for an as-you-type contact filter).
    // limit: 0 = unlimited (v4 defaults to only the top 10 results, which
    // would silently truncate a longer contact list instead of filtering it).
    const results = fuzzysort.go(query, searchable, {
      keys: ["name", "department", "designation"],
      threshold: 0,
      limit: 0,
    });

    onFilteredChange(results.map((result) => result.obj.contact));
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
