"use client";

import type { SettingDto } from "@bmp/types";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton, Switch, useToast } from "@bmp/ui";
import { Brain, CheckCircle2, CircleAlert, Loader2, RefreshCw, Upload } from "lucide-react";
import { useRef } from "react";

import { useClassificationStatus, useRebuildClassifier } from "@/hooks/use-classification";
import { useHsnSacStatus, useRefreshHsnSac, useUploadHsnSac } from "@/hooks/use-reference-data";
import { useSettings, useUpdateSetting } from "@/hooks/use-settings";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

function HsnSacCard({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const statusQuery = useHsnSacStatus();
  const refresh = useRefreshHsnSac();
  const upload = useUploadHsnSac();
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleRefresh() {
    try {
      await refresh.mutateAsync();
      toast({ title: "HSN/SAC data refreshed" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not refresh HSN/SAC data",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleUpload(file: File) {
    try {
      await upload.mutateAsync(file);
      toast({ title: "HSN/SAC data imported" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not import file",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">HSN/SAC reference data</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {statusQuery.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : statusQuery.data ? (
          <div className="text-sm text-muted-foreground">
            <p>
              {statusQuery.data.hsnRowCount.toLocaleString()} HSN / {statusQuery.data.sacRowCount.toLocaleString()}{" "}
              SAC codes · last imported {new Date(statusQuery.data.importedAt).toLocaleString()}
              {statusQuery.data.triggeredByName ? ` by ${statusQuery.data.triggeredByName}` : " (scheduled)"}
            </p>
            <p className="mt-1 truncate">Source: {statusQuery.data.sourceUrl}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No import has run yet.</p>
        )}
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void handleRefresh()} disabled={refresh.isPending}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh now
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void handleUpload(file);
              }}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={upload.isPending}
            >
              <Upload className="mr-2 h-4 w-4" /> Upload file
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Reads as a sentence, because "reclassify" on its own does not tell anyone what is happening. */
const REBUILD_STAGE_LABELS: Record<string, string> = {
  queued: "Waiting to start",
  taxonomy: "Rebuilding categories and GST rates from the sheet",
  datasets: "Rebuilding the training data",
  training: "Training the model",
  index: "Building the lookup index",
  export: "Preparing the model for the server",
  deploy: "Checking it beats the current model",
  reclassify: "Re-classifying draft BOQs",
  done: "Finished",
};

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function ClassificationCard({ canManage }: { canManage: boolean }) {
  const { toast } = useToast();
  const statusQuery = useClassificationStatus();
  const rebuild = useRebuildClassifier();

  const run = statusQuery.data?.latestRun ?? null;
  const inProgress = run?.status === "queued" || run?.status === "running";

  async function handleRebuild() {
    try {
      await rebuild.mutateAsync();
      toast({
        title: "Rebuild started",
        description: "Training takes a few minutes. This card updates as it goes.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not start the rebuild",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Brain className="h-4 w-4" /> Item classification model
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Assigns HSN codes and item categories. Edit{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">ml/data/hsn-gst-lookup.xlsx</code> — especially
          the <strong>trade_terms</strong> column, where you list the words your suppliers actually use for a
          code — then press Update to rebuild and re-classify.
        </p>

        {statusQuery.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : !statusQuery.data?.modelInstalled && !run ? (
          <p className="text-sm text-muted-foreground">
            No model is installed yet. Press Update to build one from the current sheet.
          </p>
        ) : run ? (
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <div className="flex items-center gap-2">
              {inProgress ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : run.status === "succeeded" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              ) : (
                <CircleAlert className="h-4 w-4 text-amber-600" />
              )}
              <span className="font-medium">
                {inProgress
                  ? (REBUILD_STAGE_LABELS[run.stage] ?? run.stage)
                  : run.status === "succeeded"
                    ? "Up to date"
                    : run.status === "skipped"
                      ? "Rebuilt, but not used"
                      : "Last rebuild failed"}
              </span>
            </div>

            {run.message && <p className="text-muted-foreground">{run.message}</p>}

            {run.evalAccuracy !== null && (
              <p className="text-muted-foreground">
                Scores {percent(run.evalAccuracy)} on the checked items
                {run.baselineAccuracy !== null && ` (previous model: ${percent(run.baselineAccuracy)})`}
                {run.trainedRows !== null && ` · trained on ${run.trainedRows.toLocaleString()} examples`}
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              {new Date(run.startedAt).toLocaleString()}
              {run.triggeredBy && ` · started by ${run.triggeredBy}`}
            </p>
          </div>
        ) : null}

        {canManage && (
          <Button size="sm" onClick={() => void handleRebuild()} disabled={rebuild.isPending || inProgress}>
            {inProgress ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {inProgress ? "Rebuilding…" : "Update from sheet"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function SettingControl({ setting, canManage }: { setting: SettingDto; canManage: boolean }) {
  const { toast } = useToast();
  const update = useUpdateSetting();

  async function commit(value: string | number | boolean) {
    try {
      await update.mutateAsync({ key: setting.key, value });
    } catch (error) {
      toast({
        variant: "destructive",
        title: `Could not update ${setting.label}`,
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm">{setting.label}</p>
        {setting.isOverridden && setting.updatedByName && (
          <p className="text-xs text-muted-foreground">Customized by {setting.updatedByName}</p>
        )}
      </div>
      {setting.type === "boolean" ? (
        <Switch
          checked={setting.value as boolean}
          disabled={!canManage || update.isPending}
          onCheckedChange={(checked) => void commit(checked)}
        />
      ) : (
        <Input
          className="w-40"
          type={setting.type === "number" ? "number" : "text"}
          defaultValue={String(setting.value)}
          disabled={!canManage || update.isPending}
          onBlur={(e) => {
            const raw = e.target.value;
            const parsed = setting.type === "number" ? Number(raw) : raw;
            if (parsed !== setting.value) void commit(parsed);
          }}
        />
      )}
    </div>
  );
}

export default function SettingsPage() {
  const roleName = useAuthStore((state) => state.user?.role.name);
  const canRead = hasPermission(roleName, "settings:read");
  const canManage = hasPermission(roleName, "settings:manage");
  const settingsQuery = useSettings();

  if (!canRead) {
    return <p className="text-sm text-muted-foreground">You don&apos;t have access to system settings.</p>;
  }

  const groups = new Map<string, SettingDto[]>();
  for (const setting of settingsQuery.data ?? []) {
    const list = groups.get(setting.group) ?? [];
    list.push(setting);
    groups.set(setting.group, list);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">System configuration — visible and editable by administrators only.</p>
      </div>

      <HsnSacCard canManage={canManage} />

      <ClassificationCard canManage={canManage} />

      {settingsQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        [...groups.entries()].map(([group, settings]) => (
          <Card key={group}>
            <CardHeader>
              <CardTitle className="text-base">{group}</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {settings.map((setting) => (
                <SettingControl key={setting.key} setting={setting} canManage={canManage} />
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
