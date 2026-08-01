import type { MutableRefObject } from "react";
import { toast } from "sonner";
import { haptic } from "./haptics";

/** Outbox hold window before irreversible flush. */
export const UNDO_WINDOW_MS = 5_000;

export type UndoFnRef = MutableRefObject<null | (() => Promise<void>)>;

/**
 * Bottom snackbar with an Undo action for triage / send mutations that cannot
 * be dismissed by closing a dialog.
 */
export function presentUndoToast(input: {
  title: string;
  undoRef: UndoFnRef;
  performUndo: () => Promise<void>;
  undoneTitle?: string;
}): void {
  const toastId = toast.success(input.title, {
    description: "Undo for 5 seconds",
    duration: UNDO_WINDOW_MS,
    action: {
      label: "Undo",
      onClick: () => {
        const fn = input.undoRef.current;
        input.undoRef.current = null;
        if (fn) void fn();
      },
    },
  });

  input.undoRef.current = async () => {
    haptic("selection");
    toast.dismiss(toastId);
    await input.performUndo();
    toast.success(input.undoneTitle ?? "Undone");
  };
}

/** ISO timestamp `ms` in the future (default undo window). */
export function undoDeadline(ms = UNDO_WINDOW_MS): string {
  return new Date(Date.now() + ms).toISOString();
}
