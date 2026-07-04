import type { PropsWithChildren } from "react";

export default function AuthLayout({ children }: PropsWithChildren) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Business Management Platform</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tendering, estimation & project management
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
