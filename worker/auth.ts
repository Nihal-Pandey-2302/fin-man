import { eq } from "drizzle-orm";
import type { Db } from "./db";
import { settings } from "./db/schema";

/**
 * Single-owner password login (replaces Cloudflare Access, which needs a card on file).
 * A successful login sets a signed, HttpOnly, SameSite=Strict cookie. The signing key is derived from
 * SESSION_SECRET *and* APP_PASSWORD, so changing the password signs out every device.
 * Fails closed: without both secrets, nothing behind the login is served.
 */
export const SESSION_COOKIE = "ft_session";
export const SESSION_DAYS = 180;

type AuthEnv = { APP_PASSWORD?: string; SESSION_SECRET?: string };

const encoder = new TextEncoder();
const b64url = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const authConfigured = (env: AuthEnv) => !!(env.APP_PASSWORD && env.SESSION_SECRET);

async function signingKey(env: AuthEnv) {
  return crypto.subtle.importKey("raw", encoder.encode(`${env.SESSION_SECRET}\n${env.APP_PASSWORD}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

async function sign(env: AuthEnv, expiresAt: number) {
  return b64url(await crypto.subtle.sign("HMAC", await signingKey(env), encoder.encode(`v1.${expiresAt}`)));
}

/** Constant-time string comparison (hash first so lengths don't leak). */
async function same(a: string, b: string) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest("SHA-256", encoder.encode(s))));
  return crypto.subtle.timingSafeEqual(x, y);
}

export async function createSession(env: AuthEnv, now = Date.now()): Promise<string> {
  const expiresAt = now + SESSION_DAYS * 86_400_000;
  return `${expiresAt}.${await sign(env, expiresAt)}`;
}

export async function verifySession(env: AuthEnv, token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!authConfigured(env) || !token) return false;
  const [exp, sig] = token.split(".");
  const expiresAt = Number(exp);
  if (!sig || !Number.isFinite(expiresAt) || expiresAt <= now) return false;
  return same(sig, await sign(env, expiresAt));
}

export const checkPassword = async (env: AuthEnv, password: string) => authConfigured(env) && same(password, env.APP_PASSWORD!);

export function sessionCookie(token: string, secure: boolean) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DAYS * 86_400}${secure ? "; Secure" : ""}`;
}
export const clearedCookie = (secure: boolean) => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;

// ---------------- brute-force limit ----------------
// Stored in the settings table under a key settings.ts doesn't know (so it never shows up as a setting).
const FAILURES_KEY = "auth_failures";
export const MAX_FAILURES = 10;
export const FAILURE_WINDOW_MS = 15 * 60_000;

type Failures = { count: number; since: number };

async function readFailures(db: Db, now: number): Promise<Failures> {
  const row = await db.select().from(settings).where(eq(settings.key, FAILURES_KEY)).get();
  const f = row ? (JSON.parse(row.value) as Failures) : null;
  return f && now - f.since < FAILURE_WINDOW_MS ? f : { count: 0, since: now };
}

export async function loginLocked(db: Db, now = Date.now()) {
  return (await readFailures(db, now)).count >= MAX_FAILURES;
}

export async function recordFailure(db: Db, now = Date.now()) {
  const f = await readFailures(db, now);
  const value = JSON.stringify({ count: f.count + 1, since: f.since });
  await db.insert(settings).values({ key: FAILURES_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

export async function clearFailures(db: Db) {
  await db.delete(settings).where(eq(settings.key, FAILURES_KEY));
}
