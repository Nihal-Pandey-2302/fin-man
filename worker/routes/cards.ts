import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { accounts } from "../db/schema";
import { setStatement } from "../ledger/cards";
import type { AppEnv } from "../types";
import { date, idParam } from "./validators";

const nonNegPaise = z.number().int().min(0).max(1e13);

export const cardRoutes = new Hono<AppEnv>()
  /** What a card statement asks for, as the bank states it (overrides the computed figure). */
  .put(
    "/:id/statement",
    idParam,
    zValidator("json", z.object({ statementDate: date, amountPaise: nonNegPaise, minDuePaise: nonNegPaise.nullish() })),
    async (c) => {
      const db = c.var.db;
      const { id } = c.req.valid("param");
      const card = await db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.id, id), eq(accounts.kind, "credit_card"))).get();
      if (!card) return c.json({ error: "not_a_card" }, 404);
      const body = c.req.valid("json");
      return c.json(await setStatement(db, id, body.statementDate, body.amountPaise, body.minDuePaise ?? null));
    },
  );
