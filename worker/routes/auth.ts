import { zValidator } from "@hono/zod-validator";
import { Hono, type MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";
import {
  authConfigured,
  checkPassword,
  clearedCookie,
  clearFailures,
  createSession,
  loginLocked,
  recordFailure,
  SESSION_COOKIE,
  sessionCookie,
  verifySession,
} from "../auth";
import type { AppEnv } from "../types";

/** Reachable without a session: the login itself, the health check, and SMS ingest (its own bearer secret). */
const PUBLIC = ["/api/auth", "/api/health", "/api/ingest"];
const isPublic = (path: string) => PUBLIC.some((p) => path === p || path.startsWith(`${p}/`));
const secure = (url: string) => new URL(url).protocol === "https:";

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (isPublic(c.req.path)) return next();
  if (!authConfigured(c.env)) return c.json({ error: "auth_not_configured" }, 503);
  if (!(await verifySession(c.env, getCookie(c, SESSION_COOKIE)))) return c.json({ error: "unauthenticated" }, 401);
  await next();
};

export const authRoutes = new Hono<AppEnv>()
  .get("/session", async (c) =>
    c.json({ configured: authConfigured(c.env), authenticated: await verifySession(c.env, getCookie(c, SESSION_COOKIE)) }),
  )
  .post("/login", zValidator("json", z.object({ password: z.string().min(1).max(200) })), async (c) => {
    if (!authConfigured(c.env)) return c.json({ error: "auth_not_configured" }, 503);
    const db = c.var.db;
    if (await loginLocked(db)) return c.json({ error: "too_many_attempts" }, 429);
    if (!(await checkPassword(c.env, c.req.valid("json").password))) {
      await recordFailure(db);
      return c.json({ error: "wrong_password" }, 401);
    }
    await clearFailures(db);
    c.header("Set-Cookie", sessionCookie(await createSession(c.env), secure(c.req.url)));
    return c.json({ authenticated: true });
  })
  .post("/logout", (c) => {
    c.header("Set-Cookie", clearedCookie(secure(c.req.url)));
    return c.json({ authenticated: false });
  });
