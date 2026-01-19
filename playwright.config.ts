import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  testIgnore: "**/unit/**",
  timeout: 30000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    trace: "on-first-retry"
  }
})
