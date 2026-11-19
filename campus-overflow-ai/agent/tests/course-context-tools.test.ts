import { describe, it, expect, vi } from "vitest";
import { createCourseContextTools } from "../src/tools/course-context.js";
import { asTraceId, asAgentRunId } from "../src/types/index.js";

describe("知识只读工具课程绑定", () => {
  it("没有当前课程时不装配教材读取工具", () => {
    expect(createCourseContextTools({} as never, undefined).map(tool => tool.name)).toEqual(["fetchMainMemory"]);
  });
  it("每次执行先调用当前用户后端验证，不信任模型自报课程", async () => {
    const validate = vi.fn().mockRejectedValue(new Error("课程访问已撤销"));
    const tools = createCourseContextTools({ fetchTrustedTags: validate } as never, 2);
    const index = tools.find(t => t.name === "listKnowledgeCards")!;
    await expect(index.execute!({}, { traceId: asTraceId("context-test"), agentRunId: asAgentRunId("run") })).rejects.toThrow("课程访问已撤销");
    expect(validate).toHaveBeenCalledWith(2, "context-test");
    expect(tools.every(t => t.riskLevel === "low")).toBe(true);
    expect(tools.some(t => /publish|delete|proposal|record/.test(t.name))).toBe(false);
  });
});
