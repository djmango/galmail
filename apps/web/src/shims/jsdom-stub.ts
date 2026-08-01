/**
 * Browser shim for `jsdom`. Mail sanitization uses `globalThis.window` in the
 * app; jsdom is only needed for Bun/Node unit tests.
 */
export class JSDOM {
  window: Window;
  constructor(_html?: string) {
    if (typeof globalThis !== "undefined" && "window" in globalThis) {
      this.window = (
        globalThis as typeof globalThis & { window: Window }
      ).window;
      return;
    }
    throw new Error("jsdom is unavailable in the browser bundle");
  }
}

export default { JSDOM };
