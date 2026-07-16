export interface BrowserStorageManager {
  estimate(): Promise<{ usage?: number; quota?: number }>;
  persisted?(): Promise<boolean>;
  persist?(): Promise<boolean>;
  getDirectory?: () => Promise<unknown>;
}

export interface BrowserStorageManifest {
  schemaVersion: number;
  generationId: string;
  localOnlyPending: number;
}

export type BrowserRecoveryState =
  | { state: "unsupported"; reason: "storage_api_unavailable" }
  | { state: "empty" }
  | {
      state: "ready";
      persistent: boolean;
      usage: number;
      quota: number;
      usageRatio: number;
      hydrationAllowed: boolean;
    }
  | {
      state: "recovery_required";
      reason:
        | "indexeddb_manifest_missing"
        | "opfs_generation_missing"
        | "generation_mismatch";
      localOnlyPending: number;
    };

/**
 * Validate IndexedDB metadata against OPFS before opening a mailbox.
 * Callers must enter recovery UI for `recovery_required`; creating a new key
 * or silently presenting an empty mailbox is intentionally not an option.
 */
export async function inspectPublicWebStorage(input: {
  storage?: BrowserStorageManager;
  manifest: BrowserStorageManifest | null;
  readOpfsGeneration: () => Promise<string | null>;
  hydrationLimit?: number;
}): Promise<BrowserRecoveryState> {
  if (!input.storage?.getDirectory) {
    return { state: "unsupported", reason: "storage_api_unavailable" };
  }
  const generation = await input.readOpfsGeneration();
  if (!input.manifest && !generation) return { state: "empty" };
  if (!input.manifest) {
    return {
      state: "recovery_required",
      reason: "indexeddb_manifest_missing",
      localOnlyPending: 0,
    };
  }
  if (!generation) {
    return {
      state: "recovery_required",
      reason: "opfs_generation_missing",
      localOnlyPending: input.manifest.localOnlyPending,
    };
  }
  if (generation !== input.manifest.generationId) {
    return {
      state: "recovery_required",
      reason: "generation_mismatch",
      localOnlyPending: input.manifest.localOnlyPending,
    };
  }
  const estimate = await input.storage.estimate();
  const usage = estimate.usage ?? 0;
  const quota = estimate.quota ?? 0;
  const usageRatio = quota > 0 ? usage / quota : 1;
  const persistent = (await input.storage.persisted?.()) ?? false;
  return {
    state: "ready",
    persistent,
    usage,
    quota,
    usageRatio,
    hydrationAllowed: usageRatio < (input.hydrationLimit ?? 0.8),
  };
}

/** Persistence is requested only after the UI records explicit explanation. */
export async function requestPublicWebPersistence(input: {
  storage?: BrowserStorageManager;
  userAcknowledged: boolean;
}): Promise<"granted" | "refused" | "unsupported"> {
  if (!input.userAcknowledged || !input.storage?.persist) return "unsupported";
  return (await input.storage.persist()) ? "granted" : "refused";
}

export interface ServiceWorkerContainerLike {
  register(
    scriptURL: string,
    options: { scope: string; updateViaCache: "none" },
  ): Promise<unknown>;
}

/**
 * Register an app-shell worker as an optional optimization. Provider tokens,
 * decrypted mail, and correctness-critical sync are outside this contract.
 */
export async function registerPublicWebShellWorker(input: {
  serviceWorker?: ServiceWorkerContainerLike;
  scriptUrl: string;
  scope: string;
  origin: string;
  explicitlyEnabled: boolean;
}): Promise<"registered" | "disabled" | "unsupported"> {
  if (!input.explicitlyEnabled) return "disabled";
  if (!input.serviceWorker) return "unsupported";
  const script = new URL(input.scriptUrl, input.origin);
  const scope = new URL(input.scope, input.origin);
  if (script.origin !== input.origin || scope.origin !== input.origin) {
    throw new Error("public web service worker must be same-origin");
  }
  await input.serviceWorker.register(script.toString(), {
    scope: scope.pathname,
    updateViaCache: "none",
  });
  return "registered";
}
