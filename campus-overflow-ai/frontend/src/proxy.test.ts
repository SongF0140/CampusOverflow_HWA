// proxy（Next.js 16 middleware 约定）集成测试：验证跳转目标确实来自 decideGuard 的 destination。
// 回归背景：旧实现无论判定结果一律跳登录页，导致 /admin 越权访问不到 /403、已登录用户被误送登录页。
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "./proxy";

// 造一个结构合法（三段式 base64url）但签名任意的 JWT：守卫只解 payload，不验签
function makeToken(role: string): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: "1", role })}.not-verified`;
}

const call = (path: string, token?: string) =>
  proxy(
    new NextRequest(`http://localhost:3000${path}`, {
      headers: token ? { cookie: `co_token=${token}` } : undefined,
    }),
  );

/** 302 响应的 Location；放行时返回 null */
const locationOf = (path: string, token?: string): string | null => {
  const response = call(path, token);
  return response.headers.get("location");
};

describe("proxy：受保护页未登录", () => {
  it("跳登录页并带 returnTo（含查询串）", () => {
    expect(locationOf("/teacher")).toBe(
      "http://localhost:3000/auth/login?returnTo=%2Fteacher",
    );
    expect(locationOf("/teacher/moderation?case_id=1")).toBe(
      "http://localhost:3000/auth/login?returnTo=%2Fteacher%2Fmoderation%3Fcase_id%3D1",
    );
  });
});

describe("proxy：已登录但角色不符", () => {
  it("学生访问 /admin → /403（不是登录页）", () => {
    expect(locationOf("/admin", makeToken("student"))).toBe("http://localhost:3000/403");
    expect(locationOf("/admin/users", makeToken("student"))).toBe("http://localhost:3000/403");
  });

  it("教师访问 /admin → /403", () => {
    expect(locationOf("/admin", makeToken("teacher"))).toBe("http://localhost:3000/403");
  });

  it("目标为 /403 时不附加 returnTo", () => {
    const location = locationOf("/admin", makeToken("student")) ?? "";
    expect(location).not.toContain("returnTo");
  });
});

describe("proxy：放行路径", () => {
  it("公开页与已登录访问 /admin（管理员）不产生跳转", () => {
    for (const [path, token] of [
      ["/", undefined],
      ["/courses", undefined],
      ["/questions/12", undefined],
      ["/403", undefined],
      ["/admin", makeToken("admin")],
      ["/me", makeToken("student")],
    ] as Array<[string, string | undefined]>) {
      const response = call(path, token);
      expect(response.headers.get("location"), path).toBeNull();
      expect(response.status, path).toBe(200);
    }
  });
});

describe("proxy：已登录访问登录页", () => {
  it("按角色送回对应端首页", () => {
    expect(locationOf("/auth/login", makeToken("admin"))).toBe("http://localhost:3000/admin");
    expect(locationOf("/auth/login", makeToken("teacher"))).toBe("http://localhost:3000/teacher");
    expect(locationOf("/auth/register", makeToken("student"))).toBe("http://localhost:3000/");
  });
});