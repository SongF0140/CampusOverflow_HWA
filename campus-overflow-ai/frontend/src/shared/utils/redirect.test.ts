import { describe, expect, it } from "vitest";

import { loginUrlFor, toInternalPath } from "./redirect";

describe("toInternalPath", () => {
  it("放行站内路径（含查询参数）", () => {
    expect(toInternalPath("/me")).toBe("/me");
    expect(toInternalPath("/questions/new?course_id=3")).toBe("/questions/new?course_id=3");
  });

  it("拒绝站外地址", () => {
    expect(toInternalPath("//evil.com")).toBeNull();
    expect(toInternalPath("/\\evil.com")).toBeNull();
    expect(toInternalPath("https://evil.com")).toBeNull();
    expect(toInternalPath(undefined)).toBeNull();
  });
});

describe("loginUrlFor", () => {
  it("保留查询参数，登录后能回到带参数的页面", () => {
    expect(loginUrlFor("/questions/new", "?course_id=3", "http://localhost:3000")).toBe(
      "http://localhost:3000/auth/login?returnTo=%2Fquestions%2Fnew%3Fcourse_id%3D3",
    );
  });

  it("无查询参数时只带回路径", () => {
    expect(loginUrlFor("/me", "", "http://localhost:3000")).toBe(
      "http://localhost:3000/auth/login?returnTo=%2Fme",
    );
  });
});
