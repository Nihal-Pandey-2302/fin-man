import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run inside workerd (Miniflare) with an isolated in-memory D1 per test file.
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  // Throwaway VAPID pair so push tests never depend on a developer's .dev.vars.
  const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const vapid = {
    VAPID_PUBLIC_KEY: Buffer.from(await crypto.subtle.exportKey("raw", publicKey)).toString("base64url"),
    VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey("jwk", privateKey)).d!,
    VAPID_SUBJECT: "mailto:test@example.com",
  };
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // The weekly-backup KV (not in wrangler.jsonc until the owner creates the namespace).
          kvNamespaces: ["BACKUPS"],
          bindings: { TEST_MIGRATIONS: migrations, INGEST_SECRET: "test-ingest-secret", APP_PASSWORD: "test-password", SESSION_SECRET: "test-session-secret", ...vapid },
        },
      }),
    ],
    test: {
      include: ["tests/**/*.test.ts"],
      setupFiles: ["./tests/setup.ts"],
    },
  };
});
