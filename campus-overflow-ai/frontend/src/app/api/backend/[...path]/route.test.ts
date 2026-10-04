import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const context = (path: string[]) => ({ params: Promise.resolve({ path }) });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BFF /api/backend/**", () => {
  it("登录成功写入 HttpOnly Cookie，且响应体不回传 token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          code: 200,
          data: { access_token: "jwt-1", token_type: "bearer", user: { id: 1 } },
          message: "登录成功",
        }),
      ),
    );

    const response = await POST(
      new Request("http://localhost:3000/api/backend/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ account: "someone", password: "fake-password" }),
      }),
      context(["api", "auth", "login"]),
    );

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("co_token=jwt-1");
    expect(setCookie).toContain("HttpOnly");

    const body = await response.json();
    expect(body.data.access_token).toBeUndefined();
    expect(body.data.user).toEqual({ id: 1 });
  });

  it("退出登录由 BFF 清 Cookie，不请求后端", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost:3000/api/backend/api/auth/logout", { method: "POST" }),
      context(["api", "auth", "logout"]),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie") ?? "").toContain("Max-Age=0");
    expect((await response.json()).code).toBe(200);
  });

  it("已登录请求自动注入 Authorization，并透传 x-trace-id", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ code: 200, data: null, message: "ok" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await POST(
      new Request("http://localhost:3000/api/backend/api/questions", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "co_token=jwt-9" },
        body: JSON.stringify({ title: "问题" }),
      }),
      context(["api", "questions"]),
    );

    const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer jwt-9");
    expect(headers.get("x-trace-id")).toBeTruthy();
  });

  it("后端返回 401 时清除失效 Cookie", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ code: 401, data: null, message: "未登录" }, { status: 401 })),
    );

    const response = await POST(
      new Request("http://localhost:3000/api/backend/api/users/me", {
        method: "GET",
        headers: { cookie: "co_token=expired" },
      }),
      context(["api", "users", "me"]),
    );

    expect(response.headers.get("set-cookie") ?? "").toContain("Max-Age=0");
    expect(response.status).toBe(401);
  });
});
