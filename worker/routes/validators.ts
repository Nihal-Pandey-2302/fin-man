import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

export const id = z.coerce.number().int().positive();
export const paise = z.number().int().positive().max(1e13);
export const signedPaise = z.number().int().min(-1e13).max(1e13);
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
export const instant = z.iso.datetime({ offset: true });
export const dayOfMonth = z.number().int().min(1).max(31);
export const text = (max: number) => z.string().trim().max(max);

export const idParam = zValidator("param", z.object({ id }));
