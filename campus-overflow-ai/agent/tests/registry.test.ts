import { describe, expect, it } from "vitest";

import { getTool, listTools, registerTool } from "../src/tools/registry";

// registry 是模块级单例，用自增后缀保证测试间互不影响
let seq = 0;
const makeTool = () => {
  seq += 1;
  return { name: `tool-${seq}`, description: "测试工具", riskLevel: "low" as const };
};

describe("tool whitelist registry", () => {
  it("registered tool can be queried and listed", () => {
    const tool = makeTool();
    registerTool(tool);
    expect(getTool(tool.name)).toEqual(tool);
    expect(listTools()).toContainEqual(tool);
  });

  it("duplicate registration throws", () => {
    const tool = makeTool();
    registerTool(tool);
    expect(() => registerTool(tool)).toThrow();
  });

  it("unregistered tool returns undefined", () => {
    expect(getTool("never-registered")).toBeUndefined();
  });
});
