import { describe, expect, it } from "vitest";

import { isAuthorOf } from "./ownership";

describe("isAuthorOf", () => {
  it("用户名一致时判定为作者", () => {
    expect(isAuthorOf("student01", "student01")).toBe(true);
  });

  it("不一致或未登录时不是作者", () => {
    expect(isAuthorOf("student01", "student02")).toBe(false);
    expect(isAuthorOf(null, "student01")).toBe(false);
    expect(isAuthorOf(undefined, "student01")).toBe(false);
  });
});
