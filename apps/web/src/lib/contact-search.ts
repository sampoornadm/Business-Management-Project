import type { ContactDto } from "@bmp/types";
import fuzzysort from "fuzzysort";

interface SearchableContact {
  contact: ContactDto;
  name: string;
  department: string;
  designation: string;
}

// Optimal string alignment distance (Levenshtein + adjacent transpositions,
// so "cheif" -> "chief" costs 1 edit, not 2).
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) d[i]![0] = i;
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + cost);
      }
    }
  }
  return d[a.length]![b.length]!;
}

// fuzzysort is a subsequence matcher: one wrong letter breaks the match
// entirely (nothing, not just a low score) — this hits Indian names hard,
// since transliteration variants (Chakraborty/Chakravarty,
// Krishnamurthy/Krishnamurti, Bhattacharya/Bhattacharjee) are common, not
// rare typos. This fallback tolerates a small per-word edit distance instead;
// short (<3 char) query words fall back to a plain substring check so they
// don't fuzzy-match half the list.
function typoTolerantMatch(query: string, searchable: SearchableContact): boolean {
  const queryWords = query.toLowerCase().split(/\s+/).filter(Boolean);
  const targetWords = [searchable.name, searchable.department, searchable.designation]
    .join(" ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  return queryWords.every((queryWord) =>
    targetWords.some((targetWord) =>
      queryWord.length < 3
        ? targetWord.includes(queryWord)
        : editDistance(queryWord, targetWord) <= Math.max(1, Math.floor(queryWord.length / 4)),
    ),
  );
}

export function filterContacts(query: string, contacts: ContactDto[]): ContactDto[] {
  if (!query.trim()) return contacts;

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
  const fuzzyResults = fuzzysort.go(query, searchable, {
    keys: ["name", "department", "designation"],
    threshold: 0,
    limit: 0,
  });

  const matched = new Map(fuzzyResults.map((result) => [result.obj.contact.id, result.obj.contact]));
  for (const entry of searchable) {
    if (!matched.has(entry.contact.id) && typoTolerantMatch(query, entry)) {
      matched.set(entry.contact.id, entry.contact);
    }
  }

  return [...matched.values()];
}
