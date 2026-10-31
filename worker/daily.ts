import type { Db } from "./db";
import { buildAlerts } from "./ledger/alerts";
import { reviewCount } from "./ledger/dashboard";
import { sendToAll, type PushNote } from "./push";

/**
 * Daily 09:00 IST job (cron in wrangler.jsonc): push today's alerts — card bill due, autopay account
 * short, autopays due tomorrow, salary missing, untracked autopays — plus a nudge for the review inbox.
 */
export async function runDaily(db: Db, env: Env, fetcher?: typeof fetch) {
  const [alerts, review] = await Promise.all([buildAlerts(db), reviewCount(db)]);
  const notes: PushNote[] = alerts
    .sort((a, b) => rank(b.level) - rank(a.level))
    .slice(0, 4)
    .map((a) => ({ title: a.title, body: a.body, url: a.href ?? "/", tag: a.key }));
  if (review >= 3) notes.push({ title: `${review} transactions to review`, body: "Swipe through them in a few seconds.", url: "/activity/review", tag: "review" });
  let sent = 0;
  for (const note of notes) sent += (await sendToAll(db, env, note, fetcher)).sent;
  return { notes: notes.length, sent };
}

const rank = (level: string) => (level === "danger" ? 2 : level === "warn" ? 1 : 0);
