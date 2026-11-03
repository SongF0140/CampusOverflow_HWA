import { describe, expect, it } from "vitest";
import { validateOutput } from "../src/loop/source-check.js";
import { createRunEvidence } from "../src/observability/run-evidence.js";

const sources = [{ toolName: "searchWeb", result: { kind: "external_web", sources: [{ title: "文档", url: "https://docs.example.com/questions/intro", content: "资料" }] } }];
const answer = (text: string) => ({ text, finishReason: "stop" });
describe("网络检索来源核验", () => {
  it("允许实际检索到的外部questions路径，不把它作为站内问题", () => {
    expect(() => validateOutput("chat", answer("参考[文档](https://docs.example.com/questions/intro)"), sources)).not.toThrow();
  });
  it.each(["编造[来源](https://fake.example.com/)", "参考 https://fake.example.com/", "没有任何来源的结论"])("拒绝未检索外链或缺少引用：%s", text => {
    expect(() => validateOutput("chat", answer(text), sources)).toThrow();
  });
  it("搜索为空或失败时也不能伪造外链", () => {
    expect(() => validateOutput("chat", answer("[结果](https://fake.example.com/)"), [
      { toolName: "webRetrievalAttempt", result: {} },
    ])).toThrow();
  });
  it("返工清空正文证据不清除来源约束", () => {
    const evidence = createRunEvidence();
    evidence.markWebRetrieval(); evidence.clear();
    expect(() => validateOutput("chat", answer("[结果](https://fake.example.com/)"), evidence.snapshot())).toThrow();
  });
});
