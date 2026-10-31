import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { ingestSms } from "../sms/ingest";
import type { AppEnv } from "../types";

const encoder = new TextEncoder();

/** Constant-time bearer check (doesn't leak the secret's length or prefix via timing). */
async function bearerOk(header: string | undefined, secret: string | undefined): Promise<boolean> {
  if (!secret || !header?.startsWith("Bearer ")) return false;
  const [a, b] = await Promise.all(
    [header.slice(7), secret].map((s) => crypto.subtle.digest("SHA-256", encoder.encode(s))),
  );
  return crypto.subtle.timingSafeEqual(a, b);
}

/** MacroDroid sends whatever its variable holds: epoch s/ms (number or string) or ISO. Fall back to now. */
export function parseReceivedAt(value: unknown, now = new Date()): Date {
  let d: Date | null = null;
  if (typeof value === "number" || (typeof value === "string" && /^\d{10,13}$/.test(value.trim()))) {
    const n = Number(value);
    d = new Date(n < 1e12 ? n * 1000 : n);
  } else if (typeof value === "string" && value.trim()) {
    d = new Date(value);
  }
  // Reject unparseable and implausible values (clock skew of more than a day, or before 2020).
  if (!d || Number.isNaN(+d) || +d > +now + 86_400_000 || d.getUTCFullYear() < 2020) return now;
  return d;
}

const smsSchema = z.object({
  sender: z.string().trim().min(1).max(64),
  body: z.string().min(1).max(4000),
  received_at: z.union([z.string(), z.number()]).optional(),
});

export const ingestRoutes = new Hono<AppEnv>()
  .use(async (c, next) => {
    if (!(await bearerOk(c.req.header("Authorization"), c.env.INGEST_SECRET))) {
      return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  })
  .post("/sms", zValidator("json", smsSchema), async (c) => {
    const { sender, body, received_at } = c.req.valid("json");
    const outcome = await ingestSms(c.var.db, { sender, body, receivedAt: parseReceivedAt(received_at) });
    // Always 200 for a well-formed request: retrying a duplicate/ignored/rejected SMS can't help.
    return c.json(outcome);
  });
