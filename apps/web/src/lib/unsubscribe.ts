import { invoke } from "@tauri-apps/api/core";
import type { MailMessage, UnsubscribeCapability } from "@galmail/core-api";
import {
  resolveUnsubscribeCapability,
  unsubscribeHost,
} from "@galmail/core-api";
import { isNativeShell } from "./account-session";
import { invokeErrorMessage } from "./gmail-connect";

export type UnsubscribeAction =
  | { kind: "one_click"; url: string }
  | {
      kind: "mailto";
      address: string;
      subject?: string;
      body?: string;
    }
  | { kind: "https_link"; url: string; source: "header" | "body" };

export type PerformUnsubscribeOptions = {
  /** When true, confirm dialogs note that the message will also be trashed. */
  trashAfterUnsubscribe?: boolean;
};

export function capabilityForMessage(
  message: Pick<MailMessage, "headers" | "bodyHtml">,
): UnsubscribeCapability {
  return resolveUnsubscribeCapability(message.headers, message.bodyHtml);
}

export function unsubscribeButtonVisible(
  capability: UnsubscribeCapability,
): boolean {
  return capability.kind !== "none";
}

export function unsubscribeTooltip(
  capability: UnsubscribeCapability,
): string {
  switch (capability.kind) {
    case "one_click":
      return "Unsubscribe (one-click)";
    case "mailto":
      return "Unsubscribe (send email)";
    case "https_link":
      return "Unsubscribe (open link)";
    case "body_heuristic":
      return "Unsubscribe (open link from message)";
    default:
      return "Unsubscribe";
  }
}

/** Display name for status/confirm copy (name preferred, else email). */
export function unsubscribeSenderLabel(
  message: Pick<MailMessage, "from">,
): string {
  const name = message.from.name?.trim();
  return name || message.from.email;
}

export function unsubscribeSuccessStatus(sender: string): string {
  return `Unsubscribed from ${sender}`;
}

export function unsubscribeFailureStatus(reason: string): string {
  return `Couldn't unsubscribe (${reason})`;
}

function trashConfirmSuffix(trashAfterUnsubscribe: boolean): string {
  return trashAfterUnsubscribe
    ? "\n\nThis will also move the message to Trash."
    : "";
}

function primaryAction(
  capability: UnsubscribeCapability,
): UnsubscribeAction | null {
  switch (capability.kind) {
    case "one_click":
      if (!capability.oneClickUrl) return null;
      return { kind: "one_click", url: capability.oneClickUrl };
    case "mailto":
      if (!capability.mailto) return null;
      return { kind: "mailto", ...capability.mailto };
    case "https_link":
      if (!capability.httpsUrl) return null;
      return {
        kind: "https_link",
        url: capability.httpsUrl,
        source: "header",
      };
    case "body_heuristic":
      if (!capability.bodyUrl) return null;
      return {
        kind: "https_link",
        url: capability.bodyUrl,
        source: "body",
      };
    default:
      return null;
  }
}

function confirmPrimary(
  message: MailMessage,
  capability: UnsubscribeCapability,
  action: UnsubscribeAction,
  trashAfterUnsubscribe: boolean,
): boolean {
  const from = message.from.name
    ? `${message.from.name} <${message.from.email}>`
    : message.from.email;
  const trashNote = trashConfirmSuffix(trashAfterUnsubscribe);
  if (action.kind === "one_click") {
    const host = unsubscribeHost(capability) ?? "this sender";
    return window.confirm(
      `Unsubscribe from ${from} via ${host}? This sends a one-click unsubscribe request.${trashNote}`,
    );
  }
  if (action.kind === "mailto") {
    return window.confirm(
      `Send an unsubscribe email to ${action.address}?${trashNote}`,
    );
  }
  const prefix =
    action.source === "body"
      ? "No List-Unsubscribe header was found. Open this link from the message body"
      : "Open this unsubscribe link in your browser";
  return window.confirm(`${prefix}?\n\n${action.url}${trashNote}`);
}

async function oneClickUnsubscribe(url: string): Promise<void> {
  if (!isNativeShell()) {
    throw new Error("One-click unsubscribe requires the GalMail desktop app");
  }
  await invoke("one_click_unsubscribe", { url });
}

async function openHttpsInBrowser(url: string): Promise<void> {
  if (isNativeShell()) {
    await invoke("open_external_url", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export type MailtoSendPayload = {
  to: string;
  subject: string;
  body: string;
};

export type UnsubscribeResult =
  | { status: "cancelled" }
  | { status: "success"; detail: string }
  | { status: "error"; detail: string }
  | {
      status: "mailto";
      draft: MailtoSendPayload;
      detail: string;
    };

async function offerFallbacks(
  capability: UnsubscribeCapability,
  reason: string,
  trashAfterUnsubscribe: boolean,
): Promise<UnsubscribeResult> {
  const trashNote = trashConfirmSuffix(trashAfterUnsubscribe);
  if (capability.mailto) {
    const address = capability.mailto.address;
    if (
      window.confirm(
        `${reason}\n\nSend an unsubscribe email to ${address} instead?${trashNote}`,
      )
    ) {
      return {
        status: "mailto",
        draft: {
          to: address,
          subject: capability.mailto.subject ?? "unsubscribe",
          body: capability.mailto.body ?? "",
        },
        detail: `Sending unsubscribe to ${address}`,
      };
    }
  }
  if (capability.httpsUrl) {
    if (
      window.confirm(
        `${reason}\n\nOpen this unsubscribe page in your browser instead?\n\n${capability.httpsUrl}${trashNote}`,
      )
    ) {
      try {
        await openHttpsInBrowser(capability.httpsUrl);
        return {
          status: "success",
          detail: "Opened unsubscribe page in your browser",
        };
      } catch (error) {
        return {
          status: "error",
          detail: invokeErrorMessage(error, "Could not open unsubscribe page"),
        };
      }
    }
  }
  return { status: "error", detail: reason };
}

/**
 * Run the unsubscribe cascade with confirms. Never auto-unsubscribes.
 * Mailto returns a draft for the caller to enqueue via the existing send path.
 */
export async function performUnsubscribe(
  message: MailMessage,
  options: PerformUnsubscribeOptions = {},
): Promise<UnsubscribeResult> {
  const trashAfterUnsubscribe = options.trashAfterUnsubscribe ?? false;
  const capability = capabilityForMessage(message);
  const action = primaryAction(capability);
  if (!action) return { status: "cancelled" };
  if (!confirmPrimary(message, capability, action, trashAfterUnsubscribe)) {
    return { status: "cancelled" };
  }

  if (action.kind === "one_click") {
    try {
      await oneClickUnsubscribe(action.url);
      return { status: "success", detail: "Unsubscribed via one-click" };
    } catch (error) {
      const reason = invokeErrorMessage(error, "One-click unsubscribe failed");
      return offerFallbacks(capability, reason, trashAfterUnsubscribe);
    }
  }

  if (action.kind === "mailto") {
    return {
      status: "mailto",
      draft: {
        to: action.address,
        subject: action.subject ?? "unsubscribe",
        body: action.body ?? "",
      },
      detail: `Sending unsubscribe to ${action.address}`,
    };
  }

  try {
    await openHttpsInBrowser(action.url);
    return {
      status: "success",
      detail: "Opened unsubscribe page in your browser",
    };
  } catch (error) {
    return {
      status: "error",
      detail: invokeErrorMessage(error, "Could not open unsubscribe page"),
    };
  }
}
