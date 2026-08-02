import { createElement, type MutableRefObject } from "react";
import { toast } from "sonner";
import { haptic } from "./haptics";

/** Outbox hold window before irreversible flush. */
export const UNDO_WINDOW_MS = 8_000;

export type UndoFnRef = MutableRefObject<null | (() => Promise<void>)>;

let activeUndoToastId: string | number | undefined;
let activeUndoToken = 0;

function UndoSnackbar(props: {
  title: string;
  durationMs: number;
  onUndo: () => void;
}) {
  return createElement(
    "div",
    {
      className: "galmail-undo-snackbar",
      role: "status",
      "aria-live": "polite",
    },
    createElement(
      "div",
      { className: "galmail-undo-snackbar-copy" },
      createElement(
        "strong",
        { className: "galmail-undo-snackbar-title" },
        props.title,
      ),
      createElement(
        "span",
        { className: "galmail-undo-snackbar-hint" },
        "Tap Undo to reverse",
      ),
    ),
    createElement(
      "button",
      {
        type: "button",
        className: "galmail-undo-snackbar-action",
        onClick: props.onUndo,
      },
      "Undo",
    ),
    createElement("div", {
      className: "galmail-undo-snackbar-timer",
      style: { animationDuration: `${props.durationMs}ms` },
      "aria-hidden": true,
    }),
  );
}

/**
 * Bottom snackbar with a clear Undo action for triage / send mutations that
 * cannot be dismissed by closing a dialog.
 */
export function presentUndoToast(input: {
  title: string;
  undoRef: UndoFnRef;
  performUndo: () => Promise<void>;
  undoneTitle?: string;
}): void {
  if (activeUndoToastId !== undefined) {
    toast.dismiss(activeUndoToastId);
  }
  const token = ++activeUndoToken;

  const runUndo = () => {
    const fn = input.undoRef.current;
    input.undoRef.current = null;
    if (token === activeUndoToken) {
      activeUndoToastId = undefined;
    }
    if (fn) void fn();
  };

  const toastId = toast.custom(
    () =>
      createElement(UndoSnackbar, {
        title: input.title,
        durationMs: UNDO_WINDOW_MS,
        onUndo: runUndo,
      }),
    {
      duration: UNDO_WINDOW_MS,
      className: "galmail-toast galmail-undo-toast",
      unstyled: true,
      dismissible: false,
      onDismiss: () => {
        if (token !== activeUndoToken) return;
        activeUndoToastId = undefined;
      },
      onAutoClose: () => {
        if (token !== activeUndoToken) return;
        activeUndoToastId = undefined;
        // Window elapsed; keep undoRef until flush. Keyboard Undo may still race.
      },
    },
  );

  activeUndoToastId = toastId;

  input.undoRef.current = async () => {
    if (token !== activeUndoToken) return;
    haptic("selection");
    toast.dismiss(toastId);
    activeUndoToastId = undefined;
    await input.performUndo();
    toast(input.undoneTitle ?? "Undone", {
      duration: 2_500,
      className: "galmail-toast",
      closeButton: false,
    });
  };
}

/** ISO timestamp `ms` in the future (default undo window). */
export function undoDeadline(ms = UNDO_WINDOW_MS): string {
  return new Date(Date.now() + ms).toISOString();
}
