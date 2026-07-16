import { describe, expect, it } from "bun:test";
import {
  inspectPublicWebStorage,
  registerPublicWebShellWorker,
  requestPublicWebPersistence,
  type BrowserStorageManager,
} from "./public-web.js";

function storage(input: {
  usage?: number;
  quota?: number;
  persistent?: boolean;
  persistResult?: boolean;
}): BrowserStorageManager {
  return {
    async estimate() {
      return { usage: input.usage, quota: input.quota };
    },
    async persisted() {
      return input.persistent ?? false;
    },
    async persist() {
      return input.persistResult ?? false;
    },
    async getDirectory() {
      return {};
    },
  };
}

describe("public web recovery scaffolding", () => {
  it("fails closed when IndexedDB and OPFS generations disagree", async () => {
    const result = await inspectPublicWebStorage({
      storage: storage({}),
      manifest: {
        schemaVersion: 1,
        generationId: "indexeddb-generation",
        localOnlyPending: 3,
      },
      readOpfsGeneration: async () => "opfs-generation",
    });

    expect(result).toEqual({
      state: "recovery_required",
      reason: "generation_mismatch",
      localOnlyPending: 3,
    });
  });

  it("blocks hydration under quota pressure without treating refusal as fatal", async () => {
    const manager = storage({
      usage: 90,
      quota: 100,
      persistent: false,
      persistResult: false,
    });
    const result = await inspectPublicWebStorage({
      storage: manager,
      manifest: {
        schemaVersion: 1,
        generationId: "generation",
        localOnlyPending: 0,
      },
      readOpfsGeneration: async () => "generation",
    });

    expect(result).toMatchObject({
      state: "ready",
      persistent: false,
      usageRatio: 0.9,
      hydrationAllowed: false,
    });
    expect(
      await requestPublicWebPersistence({
        storage: manager,
        userAcknowledged: true,
      }),
    ).toBe("refused");
  });

  it("does not request persistence without explicit acknowledgement", async () => {
    let called = false;
    const manager = storage({ persistResult: true });
    manager.persist = async () => {
      called = true;
      return true;
    };

    expect(
      await requestPublicWebPersistence({
        storage: manager,
        userAcknowledged: false,
      }),
    ).toBe("unsupported");
    expect(called).toBe(false);
  });

  it("registers only a same-origin opt-in app-shell worker", async () => {
    const registrations: unknown[] = [];
    const serviceWorker = {
      async register(script: string, options: unknown) {
        registrations.push({ script, options });
        return {};
      },
    };

    expect(
      await registerPublicWebShellWorker({
        serviceWorker,
        scriptUrl: "/service-worker.js",
        scope: "/",
        origin: "https://mail.example",
        explicitlyEnabled: true,
      }),
    ).toBe("registered");
    expect(registrations).toEqual([
      {
        script: "https://mail.example/service-worker.js",
        options: { scope: "/", updateViaCache: "none" },
      },
    ]);
    await expect(
      registerPublicWebShellWorker({
        serviceWorker,
        scriptUrl: "https://evil.invalid/worker.js",
        scope: "/",
        origin: "https://mail.example",
        explicitlyEnabled: true,
      }),
    ).rejects.toThrow("same-origin");
  });
});
