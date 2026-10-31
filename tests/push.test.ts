import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { runDaily } from "../worker/daily";
import { sendToAll } from "../worker/push";
import { api, db, resetLedger, schema, seedAccounts } from "./helpers";

const b64url = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** A browser-like subscription with real keys so payload encryption runs for real. */
async function fakeSubscription(endpoint: string) {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer;
  return { endpoint, keys: { p256dh: b64url(raw), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) } };
}

beforeEach(resetLedger);

describe("web push", () => {
  it("exposes the public key and stores subscriptions idempotently", async () => {
    expect(await (await api("/push/key")).json()).toEqual({ publicKey: env.VAPID_PUBLIC_KEY });
    const sub = await fakeSubscription("https://push.example.com/a");
    expect((await api("/push/subscribe", { method: "POST", json: sub })).status).toBe(201);
    expect((await api("/push/subscribe", { method: "POST", json: sub })).status).toBe(201);
    expect(await db.select().from(schema.pushSubscriptions)).toHaveLength(1);
    const bad = await api("/push/subscribe", { method: "POST", json: { ...sub, endpoint: "http://insecure.example.com" } });
    expect(bad.status).toBe(400);
  });

  it("sends encrypted VAPID-signed payloads and drops subscriptions that are gone", async () => {
    for (const e of ["https://push.example.com/ok", "https://push.example.com/gone"]) {
      await api("/push/subscribe", { method: "POST", json: await fakeSubscription(e) });
    }
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: url.endsWith("gone") ? 410 : 201 });
    }) as unknown as typeof fetch;

    const result = await sendToAll(db, env, { title: "Hi", body: "there", tag: "t" }, fetcher);
    expect(result).toEqual({ sent: 1, removed: 1, failed: 0 });
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get("content-encoding")).toBe("aes128gcm");
    expect(headers.get("authorization")).toMatch(/^vapid t=.+, k=/);
    expect((await db.select().from(schema.pushSubscriptions)).map((s) => s.endpoint)).toEqual(["https://push.example.com/ok"]);
  });

  it("the daily job pushes today's alerts", async () => {
    const { indian } = await seedAccounts();
    await api("/push/subscribe", { method: "POST", json: await fakeSubscription("https://push.example.com/x") });
    await api(`/accounts/${indian.id}/balance`, { method: "POST", json: { balancePaise: 0 } });
    await api("/autopays", { method: "POST", json: { name: "EMI", kind: "emi", accountId: indian.id, amountPaise: 100_000, dayOfMonth: 28, nextDueOn: "2099-01-01" } });
    const tomorrow = new Date(Date.now() + 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
    await db.update(schema.autopays).set({ nextDueOn: tomorrow });
    let pushes = 0;
    const fetcher = (async () => {
      pushes++;
      return new Response(null, { status: 201 });
    }) as unknown as typeof fetch;
    const r = await runDaily(db, env, fetcher);
    expect(r.notes).toBeGreaterThanOrEqual(2); // short + due tomorrow
    expect(pushes).toBe(r.notes);
  });
});
