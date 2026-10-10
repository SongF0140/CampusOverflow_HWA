// @vitest-environment node
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("前端规则检查", () => {
  it("学生路由组及动态路由的现有链接不产生死链提示，fixture 状态合法", () => {
    const script = fileURLToPath(new URL("../../scripts/check-frontend-rules.mjs", import.meta.url));
    const output = execFileSync(process.execPath, [script], { encoding: "utf8", stdio: "pipe" });
    expect(output.trim()).toBe("前端自检通过（0 个提示）");
  });
});
