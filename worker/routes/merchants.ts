import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { merchantDetail, setMerchantCategory } from "../ledger/merchants";
import type { AppEnv } from "../types";
import { id } from "./validators";

const keyParam = zValidator("param", z.object({ key: z.string().trim().min(1).max(120) }));

export const merchantRoutes = new Hono<AppEnv>()
  .get("/:key", keyParam, async (c) => {
    const detail = await merchantDetail(c.var.db, c.req.valid("param").key);
    return detail ? c.json(detail) : c.json({ error: "not_found" }, 404);
  })
  /** File the merchant under a category from now on; `applyToPast` re-files its earlier payments too. */
  .post("/:key/category", keyParam, zValidator("json", z.object({ categoryId: id, applyToPast: z.boolean().default(false) })), async (c) => {
    const { categoryId, applyToPast } = c.req.valid("json");
    const out = await setMerchantCategory(c.var.db, c.req.valid("param").key, categoryId, applyToPast);
    return out ? c.json(out) : c.json({ error: "not_found" }, 404);
  });
