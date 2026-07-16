import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  DEFAULT_THEME,
  loadPersistedTheme,
  persistTheme,
  resolveTheme,
} from "./themes";

const THEME_STORAGE_KEY = "galmail.theme";

function installMemoryLocalStorage() {
  const store = new Map<string, string>();
  const memory = {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: memory,
  });
  return memory;
}

describe("theme preference", () => {
  beforeEach(() => {
    installMemoryLocalStorage();
  });

  afterEach(() => {
    localStorage.removeItem(THEME_STORAGE_KEY);
  });

  it("defaults to system when nothing is stored", () => {
    expect(loadPersistedTheme()).toBe("system");
    expect(DEFAULT_THEME).toBe("system");
  });

  it("loads and persists light, dark, and system", () => {
    persistTheme("light");
    expect(loadPersistedTheme()).toBe("light");
    persistTheme("dark");
    expect(loadPersistedTheme()).toBe("dark");
    persistTheme("system");
    expect(loadPersistedTheme()).toBe("system");
  });

  it("resolves explicit preferences without consulting system", () => {
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("resolves system to a concrete light or dark theme", () => {
    const resolved = resolveTheme("system");
    expect(resolved === "light" || resolved === "dark").toBe(true);
  });
});
