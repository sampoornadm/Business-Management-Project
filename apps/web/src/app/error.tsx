"use client";

import { Button, EmptyState } from "@bmp/ui";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-screen items-center justify-center bg-muted/20 p-6">
      <EmptyState
        icon={TriangleAlert}
        title="Something went wrong"
        description="An unexpected error occurred. Try again, or go back to the dashboard."
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={reset}>
              Try again
            </Button>
            <Button asChild>
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}
