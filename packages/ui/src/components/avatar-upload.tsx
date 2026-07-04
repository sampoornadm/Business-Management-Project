"use client";

import { Camera, Loader2 } from "lucide-react";
import * as React from "react";


import { cn } from "../lib/utils";

import { Avatar, AvatarFallback, AvatarImage } from "./avatar";

const sizeClasses = {
  sm: "h-12 w-12",
  md: "h-20 w-20",
  lg: "h-32 w-32",
} as const;

const iconSizeClasses = {
  sm: "h-3 w-3",
  md: "h-4 w-4",
  lg: "h-5 w-5",
} as const;

export interface AvatarUploadProps {
  currentImageUrl?: string | null;
  fallbackText: string;
  onUpload: (file: File) => void | Promise<void>;
  isUploading?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function AvatarUpload({
  currentImageUrl,
  fallbackText,
  onUpload,
  isUploading = false,
  size = "md",
  className,
}: AvatarUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);

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
    <div className={cn("relative inline-flex", sizeClasses[size], className)}>
      <Avatar className={cn(sizeClasses[size])}>
        {currentImageUrl ? <AvatarImage src={currentImageUrl} alt={fallbackText} /> : null}
        <AvatarFallback className="text-lg">{fallbackText}</AvatarFallback>
      </Avatar>

      <button
        type="button"
        onClick={handleTriggerClick}
        disabled={isUploading}
        aria-label="Upload avatar image"
        className={cn(
          "absolute inset-0 flex items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed",
          isUploading && "opacity-100",
        )}
      >
        {isUploading ? (
          <Loader2 className={cn("animate-spin", iconSizeClasses[size])} />
        ) : (
          <Camera className={iconSizeClasses[size]} />
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
