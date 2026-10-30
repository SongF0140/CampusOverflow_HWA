import { describe, expect, it } from "vitest";
import { validateOutput } from "../src/loop/source-check.js";

describe("确认入口来源", () => {
  it("只允许本次后端工单对应的确认入口", () => {
    const evidence = [{ toolName: "proposeGovernance", result: { case_id: 7, confirmation_url: "/admin/moderation/approvals?case_id=7" } }];
    expect(() => validateOutput("chat", { text: "请[人工审批](/admin/moderation/approvals?case_id=7)", finishReason: "stop" }, evidence)).not.toThrow();
    expect(() => validateOutput("chat", { text: "请[人工审批](/admin/moderation/approvals?case_id=8)", finishReason: "stop" }, evidence)).toThrow();
  });
  it("认证问答链接必须来自本轮回源结果", () => {
    expect(() => validateOutput("chat", { text: "[认证回答](/questions/2#answer-3)", finishReason: "stop" },
      [{ toolName: "fetchCertifiedAnswer", result: { question_id: 2, answer_id: 3, url: "/questions/2#answer-3" } }])).not.toThrow();
    expect(() => validateOutput("chat", { text: "[其他回答](/questions/2#answer-4)", finishReason: "stop" },
      [{ toolName: "fetchCertifiedAnswer", result: { question_id: 2, answer_id: 3, url: "/questions/2#answer-3" } }])).toThrow();
  });
});
