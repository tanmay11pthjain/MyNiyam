import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/server-only-stub.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://postgres:myniyam-local@127.0.0.1:54329/myniyam_test",
      SESSION_SECRET: "test-secret-test-secret-test-secret-0123",
      OTP_TEST_MODE: "true",
      OTP_RESEND_AFTER_SEC: "0",
      DB_POOL_MAX: "10",
    },
  },
});
