"use client";

import { Loader2, Upload } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";

import { Badge } from "./badge";
import { Card, CardContent, CardHeader, CardTitle } from "./card";

export interface DocumentVersion {
  id: string;
  version: number;
  originalName: string;
  url: string;
  uploadedByName: string;
  uploadedAt: string;
  isCurrent: boolean;
  sizeBytes: number;
}

export interface DocumentUploadProps {
  label: string;
  versions: DocumentVersion[];
  onUpload: (file: File) => void | Promise<void>;
  isUploading?: boolean;
  accept?: string;
  className?: string;
}

const DEFAULT_ACCEPT =
  "application/pdf,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  const formatted = exponent === 0 ? value.toString() : value.toFixed(1);
  return `${formatted} ${units[exponent]}`;
}

export function DocumentUpload({
  label,
  versions,
  onUpload,
  isUploading = false,
  accept = DEFAULT_ACCEPT,
  className,
}: DocumentUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [showHistory, setShowHistory] = React.useState(false);

  const currentVersion = versions.find((version) => version.isCurrent) ?? versions[0];
  const hasVersions = versions.length > 0;
  const historyVersions = [...versions].sort((a, b) => b.version - a.version);

  const handleTriggerClick = () => {
    if (!isUploading) {
      inputRef.current?.click();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void onUpload(file);
    }
    event.target.value = "";
  };

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleFileChange}
          className="hidden"
        />

        {!hasVersions ? (
          <button
            type="button"
            onClick={handleTriggerClick}
            disabled={isUploading}
            className={cn(
              "flex w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed border-input bg-background px-4 py-8 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {isUploading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <Upload className="h-6 w-6" />
            )}
            <span>{isUploading ? "Uploading..." : "No file uploaded yet"}</span>
            {!isUploading ? <span className="text-xs">Click to upload file</span> : null}
          </button>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4 rounded-md border p-3">
              <div className="min-w-0 flex-1">
                <a
                  href={currentVersion?.url}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-sm font-medium text-primary hover:underline"
                >
                  {currentVersion?.originalName}
                </a>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  Uploaded by {currentVersion?.uploadedByName} on{" "}
                  {currentVersion ? new Date(currentVersion.uploadedAt).toLocaleString() : ""} &middot;{" "}
                  {currentVersion ? formatBytes(currentVersion.sizeBytes) : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={handleTriggerClick}
                disabled={isUploading}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-input bg-background px-3 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                )}
              >
                {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Replace
              </button>
            </div>

            {versions.length > 1 ? (
              <div>
                <button
                  type="button"
                  onClick={() => setShowHistory((value) => !value)}
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  {showHistory ? "Hide" : "Show"} version history ({versions.length})
                </button>
                {showHistory ? (
                  <ul className="mt-2 space-y-2">
                    {historyVersions.map((version) => (
                      <li
                        key={version.id}
                        className="flex items-center justify-between gap-4 rounded-md border p-2 text-xs"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <Badge variant="secondary" className="shrink-0 font-semibold">
                            v{version.version}
                          </Badge>
                          <div className="min-w-0">
                            <a
                              href={version.url}
                              target="_blank"
                              rel="noreferrer"
                              className="block truncate font-medium text-primary hover:underline"
                            >
                              {version.originalName}
                            </a>
                            <p className="truncate text-muted-foreground">
                              {version.uploadedByName} &middot; {new Date(version.uploadedAt).toLocaleString()}{" "}
                              &middot; {formatBytes(version.sizeBytes)}
                            </p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
