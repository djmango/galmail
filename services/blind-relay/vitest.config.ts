import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    env: { VITEST: "true", GALMAIL_RELAY_LISTEN: "0" },
  },
});
