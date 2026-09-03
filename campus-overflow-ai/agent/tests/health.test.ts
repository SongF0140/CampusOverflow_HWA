import { describe, expect, it } from "vitest";

import { createApp, healthPayload } from "../src/app";

describe("agent health endpoint", () => {
  it("returns unified response payload", async () => {
    const app = createApp();
    const res = await app.request("/agent/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(healthPayload());
    expect(body.data.service).toBe("agent");
    expect(body.data.status).toBe("up");
  });

  it("exposes root health alias", async () => {
    const app = createApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
  });
});
