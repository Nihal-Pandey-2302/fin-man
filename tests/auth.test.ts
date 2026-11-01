// Password login: everything but login, health and SMS ingest needs the owner's session cookie.
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createSession, MAX_FAILURES, SESSION_COOKIE, verifySession } from "../worker/auth";
import { api, db, fixture, postSms, resetLedger, schema, seedAccounts } from "./helpers";

const login = (password: string) => api("/auth/login", { method: "POST", json: { password }, auth: false });
const withCookie = (path: string, token: string) => api(path, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
beforeEach(async () => {
  await resetLedger();
  await db.delete(schema.settings);
});

describe("auth", () => {
  it("refuses data without a session, but keeps health and SMS ingest reachable", async () => {
    for (const path of ["/dashboard", "/transactions", "/export", "/accounts"]) {
      expect((await api(path, { auth: false })).status, path).toBe(401);
    }
    expect((await api("/health", { auth: false })).status).toBe(200);
    await seedAccounts();
    expect(await (await postSms("JD-IDFCFB-S", fixture("idfc/credit.txt"))).json()).toMatchObject({ status: "created" });
  });

  it("logs in with the right password and the cookie unlocks the API", async () => {
    expect((await login("nope")).status).toBe(401);
    const res = await login("test-password");
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    const token = /ft_session=([^;]+)/.exec(cookie)![1];
    expect((await withCookie("/dashboard", token)).status).toBe(200);
    expect(await (await withCookie("/auth/session", token)).json()).toEqual({ configured: true, authenticated: true });
  });

  it("rejects tampered and expired sessions, and sessions signed before a password change", async () => {
    const token = await createSession(env);
    const [exp, sig] = token.split(".");
    expect((await withCookie("/dashboard", `${Number(exp) + 1}.${sig}`)).status).toBe(401);
    expect((await withCookie("/dashboard", await createSession(env, Date.now() - 200 * 86_400_000))).status).toBe(401);
    expect(await verifySession({ ...env, APP_PASSWORD: "changed" }, token)).toBe(false);
    expect(await verifySession({ ...env, APP_PASSWORD: "" }, token)).toBe(false);
  });

  it("locks the login after repeated wrong passwords", async () => {
    for (let i = 0; i < MAX_FAILURES; i++) expect((await login(`guess-${i}`)).status).toBe(401);
    // Even the right password is refused while locked.
    expect((await login("test-password")).status).toBe(429);
    // The counter never shows up as a setting.
    expect(Object.keys(await (await api("/settings")).json())).not.toContain("auth_failures");
  });

  it("logout clears the cookie", async () => {
    const res = await api("/auth/logout", { method: "POST", auth: false });
    expect(res.headers.get("set-cookie")).toMatch(/ft_session=;.*Max-Age=0/);
  });
});
