"use client";

import type { PortalProfileQuestionDto } from "@bmp/types";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton, useToast } from "@bmp/ui";
import { Pencil } from "lucide-react";
import { useState } from "react";

import { usePortalProfile, useUpdatePortalProfile } from "@/hooks/use-portal-bids";

const COMMENT_SUFFIX = ".comment";

function ReadOnlyRow({ question, note }: { question: PortalProfileQuestionDto; note: string }) {
  return (
    <div className="grid gap-1 text-sm sm:grid-cols-[2fr_3fr]">
      <p className="text-muted-foreground">{question.label}</p>
      <p>{question.value || <span className="text-muted-foreground">{note}</span>}</p>
    </div>
  );
}

/**
 * The answers filled into the SAIL ISP bid form for this business: the editable ones kept in the
 * portal profile, plus (read-only) those the Business record or each tender supplies.
 */
export function PortalProfileCard() {
  const { toast } = useToast();
  const profileQuery = usePortalProfile();
  const update = useUpdatePortalProfile();
  const [draft, setDraft] = useState<Record<string, string> | null>(null);

  if (profileQuery.isLoading || !profileQuery.data) return <Skeleton className="h-48 w-full" />;
  const profile = profileQuery.data;
  const stored = (key: string) =>
    key.endsWith(COMMENT_SUFFIX)
      ? (profile.questions.find((q) => q.key === key.slice(0, -COMMENT_SUFFIX.length))?.comment ?? "")
      : (profile.questions.find((q) => q.key === key)?.value ?? "");

  const editable = profile.questions.filter((q) => q.source === "profile");
  const fromBusiness = profile.questions.filter((q) => q.source === "business");
  const fromTender = profile.questions.filter((q) => q.source === "tender");

  async function handleSave() {
    if (!draft) return;
    const changed = Object.fromEntries(Object.entries(draft).filter(([key, value]) => value !== stored(key)));
    try {
      if (Object.keys(changed).length > 0) await update.mutateAsync({ answers: changed });
      toast({ title: "Portal profile saved" });
      setDraft(null);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not save the portal profile",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  function startEditing() {
    const initial: Record<string, string> = {};
    for (const q of editable) {
      initial[q.key] = q.value;
      if (q.hasComment) initial[`${q.key}${COMMENT_SUFFIX}`] = q.comment;
    }
    setDraft(initial);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">SAIL ISP portal profile</CardTitle>
          <p className="text-sm text-muted-foreground">
            Typed into every SAIL ISP bid form for {profile.businessName}. The billing party is the client (IISCO).
          </p>
        </div>
        {draft ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setDraft(null)} disabled={update.isPending}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={update.isPending}>
              Save
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={startEditing}>
            <Pencil className="mr-2 h-4 w-4" /> Edit
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <h3 className="text-sm font-medium">Saved answers</h3>
          {editable.map((q) => (
            <div key={q.key} className="grid gap-1 text-sm sm:grid-cols-[2fr_3fr]">
              <label htmlFor={`pp-${q.key}`} className="text-muted-foreground">
                {q.label}
              </label>
              {draft ? (
                <div className="space-y-1">
                  <Input
                    id={`pp-${q.key}`}
                    value={draft[q.key] ?? ""}
                    onChange={(event) => setDraft({ ...draft, [q.key]: event.target.value })}
                  />
                  {q.hasComment && (
                    <Input
                      aria-label={`${q.label} comment`}
                      placeholder="Comment"
                      value={draft[`${q.key}${COMMENT_SUFFIX}`] ?? ""}
                      onChange={(event) => setDraft({ ...draft, [`${q.key}${COMMENT_SUFFIX}`]: event.target.value })}
                    />
                  )}
                </div>
              ) : (
                <div>
                  <p>{q.value || <span className="text-muted-foreground">Not set</span>}</p>
                  {q.hasComment && q.comment && <p className="text-muted-foreground">Comment: {q.comment}</p>}
                </div>
              )}
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">From the business record (edit the business to change)</h3>
          {fromBusiness.map((q) => (
            <ReadOnlyRow key={q.key} question={q} note="Not on the business record" />
          ))}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Worked out from each tender&apos;s BOQ</h3>
          {fromTender.map((q) => (
            <ReadOnlyRow key={q.key} question={q} note="Set per tender" />
          ))}
        </section>
      </CardContent>
    </Card>
  );
}
