import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch } from "./client";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("只请求同源 BFF 地址，并解包统一响应", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        jsonResponse({ code: 200, data: { id: 1 }, message: "ok" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const data = await apiFetch<{ id: number }>("/users/me");

    expect(data).toEqual({ id: 1 });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/backend/api/users/me");
  });

  it("业务错误抛出 ApiError，并带上中文提示", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ code: 401, data: null, message: "未登录" }, 401)),
    );

    await expect(apiFetch("/users/me")).rejects.toBeInstanceOf(ApiError);
    await expect(apiFetch("/users/me")).rejects.toMatchObject({ code: 401, message: "未登录" });
  });

  it("响应不是 JSON 时降级为通用中文提示", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));

    await expect(apiFetch("/users/me")).rejects.toMatchObject({
      code: 500,
      message: "服务暂时不可用，请稍后重试",
    });
  });
});
