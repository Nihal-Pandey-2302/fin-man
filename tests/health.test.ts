import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("GET /api/health", () => {
  it("reports the worker and D1 are up", async () => {
    const res = await exports.default.fetch("http://local/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, db: true });
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const res = await exports.default.fetch("http://local/api/nope");
    expect(res.status).toBe(404);
  });
});
