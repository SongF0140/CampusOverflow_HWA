import { describe, expect, it, vi, afterEach } from "vitest";

import { GET } from "./route";

const mockFetch = (status: number) =>
  vi.fn(async () => new Response("{}", { status }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/health", () => {
  it("aggregates all services as up when downstream healthy", async () => {
    vi.stubGlobal("fetch", mockFetch(200));
    const res = await GET();
    const body = await res.json();
    expect(body.code).toBe(200);
    expect(body.data).toEqual({ frontend: "up", backend: "up", agent: "up" });
  });

  it("degrades gracefully when agent service is down", async () => {
    // fetch 抛错表示服务不可达，接口本身仍返回 200
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).includes("8787")) {
          throw new Error("connection refused");
        }
        return new Response("{}", { status: 200 });
      }),
    );
    const res = await GET();
    const body = await res.json();
    expect(body.data.agent).toBe("down");
    expect(body.data.backend).toBe("up");
  });
});
