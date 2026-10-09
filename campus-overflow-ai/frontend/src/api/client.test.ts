import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiFetch, buildQuery } from "./client";

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

describe("buildQuery", () => {
  it("蛇形键直传，undefined/null/空串不出现，布尔与数字转字符串", () => {
    expect(
      buildQuery({
        page: 2,
        page_size: 20,
        sort: "hot",
        unresolved: true,
        tag_id: undefined,
        course_id: null,
        keyword: "",
      }),
    ).toBe("?page=2&page_size=20&sort=hot&unresolved=true");
  });

  it("无有效参数时返回空串，中文值按 URL 编码", () => {
    expect(buildQuery()).toBe("");
    expect(buildQuery({ keyword: "红黑树" })).toBe("?keyword=%E7%BA%A2%E9%BB%91%E6%A0%91");
  });
});
