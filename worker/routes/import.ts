import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { ingestSms, type IngestStatus } from "../sms/ingest";
import type { AppEnv } from "../types";

/** Small batches: the Workers free plan allows ~10 ms of CPU per request. */
export const IMPORT_BATCH = 20;

const batchSchema = z.object({
  messages: z
    .array(
      z.object({
        sender: z.string().trim().min(1).max(64),
        body: z.string().min(1).max(4000),
        receivedAt: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(IMPORT_BATCH),
});

/**
 * Backfill from an "SMS Backup & Restore" export (parsed in the browser). Same pipeline as the live
 * endpoint, so re-importing is harmless: every SMS is stored once.
 */
export const importRoutes = new Hono<AppEnv>().post("/sms", zValidator("json", batchSchema), async (c) => {
  const counts: Record<IngestStatus, number> = { created: 0, duplicate: 0, ignored: 0, unparsed: 0, rejected: 0 };
  for (const m of c.req.valid("json").messages) {
    const out = await ingestSms(c.var.db, { sender: m.sender, body: m.body, receivedAt: new Date(m.receivedAt) });
    counts[out.status]++;
  }
  return c.json(counts);
});
