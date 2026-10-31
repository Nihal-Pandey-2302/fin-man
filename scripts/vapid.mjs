#!/usr/bin/env node
// `npm run vapid` → prints a fresh VAPID key pair for web push, and adds it to .dev.vars if missing there.
// For production: `npx wrangler secret put VAPID_PRIVATE_KEY` (and set VAPID_PUBLIC_KEY / VAPID_SUBJECT).
import { existsSync, readFileSync, appendFileSync } from "node:fs";

const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));
const jwk = await crypto.subtle.exportKey("jwk", privateKey);
const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
const lines = [`VAPID_PUBLIC_KEY=${b64url(raw)}`, `VAPID_PRIVATE_KEY=${jwk.d}`, "VAPID_SUBJECT=mailto:fintrack@example.com"];

const current = existsSync(".dev.vars") ? readFileSync(".dev.vars", "utf8") : "";
if (/^VAPID_PRIVATE_KEY=/m.test(current)) {
  console.log(".dev.vars already has VAPID keys; new pair (not written):\n" + lines.join("\n"));
} else {
  appendFileSync(".dev.vars", `${current.endsWith("\n") || !current ? "" : "\n"}${lines.join("\n")}\n`);
  console.log("Added VAPID keys to .dev.vars");
}
