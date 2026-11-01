import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { api } from "./helpers";

describe("GET /api/health", () => {
  it("reports the worker and D1 are up", async () => {
    const res = await exports.default.fetch("http://local/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: true });
  });

  it("returns JSON 404 for unknown API routes (401 before login: no route map for strangers)", async () => {
    expect((await exports.default.fetch("http://local/api/nope")).status).toBe(401);
    const res = await api("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
