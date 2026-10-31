import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";
import { eq } from "drizzle-orm";
import type { Db } from "./db";
import { pushSubscriptions } from "./db/schema";

export type PushNote = { title: string; body: string; url?: string; tag?: string };
type VapidEnv = { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string };

export const pushConfigured = (env: VapidEnv) => !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);

/**
 * Send a notification to every subscribed device. Subscriptions the push service reports as gone
 * (404/410) are deleted. `fetcher` is injectable for tests.
 */
export async function sendToAll(db: Db, env: VapidEnv, note: PushNote, fetcher: typeof fetch = fetch) {
  if (!pushConfigured(env)) return { sent: 0, removed: 0, failed: 0 };
  const vapid = { subject: env.VAPID_SUBJECT ?? "mailto:fintrack@example.com", publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  const subs = await db.select().from(pushSubscriptions).all();
  let sent = 0;
  let removed = 0;
  let failed = 0;
  for (const s of subs) {
    const subscription: PushSubscription = { endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      const payload = await buildPushPayload({ data: JSON.stringify(note), options: { ttl: 12 * 3600, urgency: "normal", topic: note.tag?.slice(0, 32).replace(/[^A-Za-z0-9_-]/g, "_") } }, subscription, vapid);
      const res = await fetcher(s.endpoint, payload);
      if (res.status === 404 || res.status === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        removed++;
      } else if (res.ok) sent++;
      else failed++;
    } catch (err) {
      console.error("push failed", err);
      failed++;
    }
  }
  return { sent, removed, failed };
}
