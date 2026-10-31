import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { pushSubscriptions } from "../db/schema";
import { pushConfigured, sendToAll } from "../push";
import type { AppEnv } from "../types";

const subscriptionSchema = z.object({
  endpoint: z.url().startsWith("https://").max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

export const pushRoutes = new Hono<AppEnv>()
  .get("/key", (c) => c.json({ publicKey: pushConfigured(c.env) ? c.env.VAPID_PUBLIC_KEY : null }))
  .post("/subscribe", zValidator("json", subscriptionSchema), async (c) => {
    const { endpoint, keys } = c.req.valid("json");
    await c.var.db
      .insert(pushSubscriptions)
      .values({ endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent: c.req.header("user-agent")?.slice(0, 200) ?? null })
      .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { p256dh: keys.p256dh, auth: keys.auth } });
    return c.json({ subscribed: true }, 201);
  })
  .post("/unsubscribe", zValidator("json", z.object({ endpoint: z.string().max(1000) })), async (c) => {
    await c.var.db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, c.req.valid("json").endpoint));
    return c.json({ unsubscribed: true });
  })
  .post("/test", async (c) => c.json(await sendToAll(c.var.db, c.env, { title: "fintrack", body: "Notifications are working ✓", url: "/", tag: "test" })));
