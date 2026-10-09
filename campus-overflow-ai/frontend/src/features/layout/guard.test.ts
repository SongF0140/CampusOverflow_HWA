import { describe, expect, it } from "vitest";

import {
  decodeJwtPayload,
  decideGuard,
  homePathForRole,
  isProtectedPath,
  roleFromToken,
} from "./guard";

// 造一个结构合法（三段式 base64url）但签名任意的 JWT：守卫只解 payload，不验签
function makeToken(role: string, sub = "1"): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub, role })}.not-verified`;
}

describe("decodeJwtPayload / roleFromToken", () => {
  it("解出 payload 中的 sub 与 role", () => {
    expect(decodeJwtPayload(makeToken("teacher", "7"))).toEqual({ sub: "7", role: "teacher" });
    expect(roleFromToken(makeToken("admin"))).toBe("admin");
  });

  it("无 Cookie / 缺段 / 乱码 / 未知角色一律返回 null", () => {
    expect(roleFromToken(null)).toBeNull();
    expect(roleFromToken(undefined)).toBeNull();
    expect(decodeJwtPayload("abc.def")).toBeNull();
    expect(decodeJwtPayload("header.!!!not-base64!!!.sig")).toBeNull();
    expect(roleFromToken(makeToken("root"))).toBeNull();
  });
});

describe("isProtectedPath", () => {
  it("受保护前缀与 /questions/[id]/edit 命中", () => {
    for (const path of [
      "/teacher",
      "/teacher/courses",
      "/admin",
      "/admin/users",
      "/me",
      "/me/memories",
      "/notifications",
      "/questions/new",
      "/questions/12/edit",
      "/appeals/new",
    ]) {
      expect(isProtectedPath(path), path).toBe(true);
    }
  });

  it("公开页与相近路径不命中", () => {
    for (const path of [
      "/",
      "/courses",
      "/rankings",
      "/search",
      "/questions/12",
      "/questions/12/edit/preview",
      "/auth/login",
      "/403",
    ]) {
      expect(isProtectedPath(path), path).toBe(false);
    }
  });
});

describe("decideGuard：未登录（无 Cookie）", () => {
  const cases: Array<[string, string]> = [
    ["/teacher", "/auth/login?returnTo=%2Fteacher"],
    ["/teacher/moderation", "/auth/login?returnTo=%2Fteacher%2Fmoderation"],
    ["/admin", "/auth/login?returnTo=%2Fadmin"],
    ["/me", "/auth/login?returnTo=%2Fme"],
    ["/notifications", "/auth/login?returnTo=%2Fnotifications"],
    ["/questions/new", "/auth/login?returnTo=%2Fquestions%2Fnew"],
    ["/questions/12/edit", "/auth/login?returnTo=%2Fquestions%2F12%2Fedit"],
    ["/appeals/new", "/auth/login?returnTo=%2Fappeals%2Fnew"],
  ];

  it.each(cases)("访问 %s → 302 登录页并带 returnTo", (path, destination) => {
    expect(decideGuard(path, null)).toEqual({ action: "redirect", destination });
  });

  it("returnTo 保留查询串", () => {
    expect(decideGuard("/teacher", null, "?case_id=1")).toEqual({
      action: "redirect",
      destination: "/auth/login?returnTo=%2Fteacher%3Fcase_id%3D1",
    });
  });

  it("公开页与登录页放行", () => {
    for (const path of ["/", "/courses", "/questions/12", "/auth/login", "/403"]) {
      expect(decideGuard(path, null)).toEqual({ action: "allow" });
    }
  });
});

describe("decideGuard：已登录（按 JWT role 判定，不验签）", () => {
  it("/admin/** 仅 admin 放行，其余角色 → /403", () => {
    expect(decideGuard("/admin", makeToken("admin"))).toEqual({ action: "allow" });
    expect(decideGuard("/admin/users", makeToken("admin"))).toEqual({ action: "allow" });
    expect(decideGuard("/admin", makeToken("student"))).toEqual({
      action: "redirect",
      destination: "/403",
    });
    expect(decideGuard("/admin/users", makeToken("teacher"))).toEqual({
      action: "redirect",
      destination: "/403",
    });
  });

  it("/teacher/** 教师与管理员放行；学生放行（助教=学生+能力位，JWT 无能力位，页面层处理）", () => {
    for (const role of ["teacher", "admin", "student"]) {
      expect(decideGuard("/teacher/courses", makeToken(role))).toEqual({ action: "allow" });
    }
  });

  it("已登录访问登录/注册页按角色送回对应端首页", () => {
    expect(decideGuard("/auth/login", makeToken("admin"))).toEqual({
      action: "redirect",
      destination: "/admin",
    });
    expect(decideGuard("/auth/login", makeToken("teacher"))).toEqual({
      action: "redirect",
      destination: "/teacher",
    });
    expect(decideGuard("/auth/register", makeToken("student"))).toEqual({
      action: "redirect",
      destination: "/",
    });
  });

  it("公开页已登录直接放行", () => {
    expect(decideGuard("/", makeToken("student"))).toEqual({ action: "allow" });
  });
});

describe("homePathForRole", () => {
  it("按角色落到对应端首页（与 session-store.homePathFor 同口径）", () => {
    expect(homePathForRole("admin")).toBe("/admin");
    expect(homePathForRole("teacher")).toBe("/teacher");
    expect(homePathForRole("student")).toBe("/");
  });
});
