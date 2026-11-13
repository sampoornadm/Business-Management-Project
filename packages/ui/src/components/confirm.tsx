"use client";

import * as React from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";
import { buttonVariants } from "./button";

export interface ConfirmOptions {
  title: string;
  description?: string;
  /** Label of the confirming button. Name the action ("Delete contact"), not "OK". */
  confirmLabel: string;
  /** False for a confirmation that doesn't destroy anything (the button is then not red). */
  destructive?: boolean;
}

type Request = ConfirmOptions & { resolve: (confirmed: boolean) => void };

// Same shape as the toast store: one module-level hook the mounted host registers into,
// so any handler can ask without threading a provider or a hook through its component.
let present: ((request: Request) => void) | null = null;

/**
 * Asks "are you sure?" in the app's own dialog and resolves to the answer:
 * `if (!(await confirmAction({ title: "Delete this file?", confirmLabel: "Delete file" }))) return;`
 * Needs one `<ConfirmHost />` mounted; without it, falls back to the browser's native prompt.
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  if (!present) {
    return Promise.resolve(window.confirm([options.title, options.description].filter(Boolean).join("\n\n")));
  }
  return new Promise((resolve) => present?.({ ...options, resolve }));
}

export function ConfirmHost() {
  const [request, setRequest] = React.useState<Request | null>(null);

  React.useEffect(() => {
    present = setRequest;
    return () => {
      present = null;
    };
  }, []);

  function answer(confirmed: boolean) {
    request?.resolve(confirmed);
    setRequest(null);
  }

  return (
    <AlertDialog open={request !== null} onOpenChange={(open) => !open && answer(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          {request?.description && <AlertDialogDescription>{request.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={request?.destructive === false ? buttonVariants({ variant: "default" }) : undefined}
            onClick={() => answer(true)}
          >
            {request?.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
