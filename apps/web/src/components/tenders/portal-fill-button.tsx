"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useToast,
} from "@bmp/ui";
import { CheckCircle2, Globe, Loader2, TriangleAlert, Upload } from "lucide-react";
import { useEffect, useState } from "react";

import { useOpenPortalBrowser, usePortalFillJob, useStartPortalFill } from "@/hooks/use-portal-bids";

function Issues({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">{title}</p>
      <ul className="max-h-32 list-disc space-y-0.5 overflow-y-auto pl-5 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Types this tender's bid into the SAIL ISP response open in the user's own Chrome. The button is
 * its own progress bar: green fills left to right, the first half for the Questions page and the
 * second for the item prices. It never saves or submits on the portal.
 */
export function PortalFillButton({ tenderId }: { tenderId: string }) {
  const { toast } = useToast();
  const start = useStartPortalFill();
  const [jobId, setJobId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const job = usePortalFillJob(jobId).data;

  const running = start.isPending || job?.status === "running";
  const progress = job?.progress ?? 0;

  // Open the popup once per job, when it stops running.
  const finished = job && job.status !== "running" ? job.id : null;
  useEffect(() => {
    if (finished) setDialogOpen(true);
  }, [finished]);

  async function handleClick() {
    try {
      const started = await start.mutateAsync(tenderId);
      setJobId(started.id);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not start the portal fill",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  const result = job?.status === "done" ? job.result : undefined;
  const hasIssues = Boolean(result && (result.mismatches.length > 0 || result.skipped.length > 0));

  return (
    <>
      <Button
        variant="outline"
        onClick={handleClick}
        disabled={running}
        className="relative overflow-hidden"
        role="progressbar"
        aria-label="Fill portal bid"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={running ? progress : undefined}
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-green-500/40 transition-[width] duration-300 ease-out"
          style={{ width: running ? `${progress}%` : "0%" }}
        />
        <span className="relative flex items-center">
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          {running ? `Filling… ${progress}%` : "Fill portal bid"}
        </span>
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          {job?.status === "failed" ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <TriangleAlert className="h-5 w-5 text-destructive" /> The form was not filled
                </DialogTitle>
                <DialogDescription>{job.error}</DialogDescription>
              </DialogHeader>
            </>
          ) : result ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {hasIssues ? (
                    <TriangleAlert className="h-5 w-5 text-signal" />
                  ) : (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  )}
                  {hasIssues ? "The form is filled, with items to check" : "The form has been filled"}
                </DialogTitle>
                <DialogDescription>
                  Portal response {result.responseNumber}: {result.filled} fields filled. Nothing was saved or
                  submitted. Review the form on the portal, then Save and Submit it yourself.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <Issues title="Does not match the portal" items={result.mismatches} />
                <Issues title="Skipped" items={result.skipped} />
                <Issues title="Warnings" items={result.warnings} />
              </div>
            </>
          ) : null}
          <DialogFooter>
            <Button onClick={() => setDialogOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Opens the app's own browser window on the machine the server runs on, to log into the portal. */
export function OpenPortalBrowserButton() {
  const { toast } = useToast();
  const open = useOpenPortalBrowser();

  async function handleClick() {
    try {
      const status = await open.mutateAsync();
      toast({
        title: "Portal browser opened",
        description: status.onResponsePage
          ? `Response ${status.responseNumber} is open and ready to fill.`
          : "Log in and open your bid response in the window that opened.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not open the portal browser",
        description:
          error instanceof Error ? error.message : "Run `pnpm portal:browser:install` on the server, then try again.",
      });
    }
  }

  return (
    <Button variant="outline" onClick={handleClick} disabled={open.isPending}>
      {open.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Globe className="mr-2 h-4 w-4" />}
      Open portal browser
    </Button>
  );
}
