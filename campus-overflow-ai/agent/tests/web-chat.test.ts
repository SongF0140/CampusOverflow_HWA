import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { createApp } from "../src/app.js";
import type { UserInternalClient } from "../src/internal-client.js";
import { auditStub } from "./helpers/audit-stub.js";
import { approvedReview } from "./helpers/review-response.js";

const usage = { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } };
const source = { title: "公开文档", url: "https://example.com/reference", content: "PUBLIC_REFERENCE" };
const fixture = (text: string) => {
  const order: string[] = [];
  const generate = vi.fn(async (options: Parameters<MockLanguageModelV4["doGenerate"]>[0]) => approvedReview(options) ?? ({
    content: [{ type: "text" as const, text: JSON.stringify({ steps: [
      { stepId: "s1", objective: "检索公开来源", toolName: "searchWeb", args: { query: "公开算法文档" } },
      { stepId: "s2", objective: "读取公开来源", toolName: "readWebPage", args: { url: "$s1.sources[0].url" } },
    ] }) }], finishReason: { unified: "stop" as const, raw: undefined }, usage, warnings: [],
  }));
  const stream = vi.fn(async () => {
    order.push("answer");
    return { stream: simulateReadableStream({ chunks: [
      { type: "stream-start", warnings: [] }, { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: text }, { type: "text-end", id: "t1" },
      { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage },
    ] }) };
  });
  const model = new MockLanguageModelV4({ doGenerate: generate, doStream: stream });
  const client = { audit: auditStub(1), resolvePrincipal: vi.fn().mockResolvedValue({ user_id: 1, role: "student", status: "active",
    identity_type: "undergraduate", assistant_cert_status: "none" }) } as unknown as UserInternalClient;
  const app = createApp({ getModel: () => model, createClient: () => client, webTools: {
    config: { enabled: true, browserEnabled: true, apiKey: "CANARY_SERVICE_KEY_NOT_MODEL_DATA" },
    search: async () => { order.push("search"); return [source]; },
    read: async url => { order.push("read"); return { url, content: "PUBLIC_REFERENCE_BODY" }; },
  } });
  return { order, model, request: () => app.request("/agent/chat", { method: "POST", headers: { authorization: "Bearer user" },
    body: JSON.stringify({ message: "请检索公开算法资料再回答" }) }) };
};

describe("回答前公共网络工具接线", () => {
  it("学生先搜索和读取再回答，真实来源和无凭据进入最终模型输入", async () => {
    const f = fixture("参考[公开文档](https://example.com/reference)，这里是解释。");
    const response = await f.request(); const body = await response.text();
    expect(body).toContain("event: done");
    expect(f.order).toEqual(["search", "read", "answer"]);
    const prompts = JSON.stringify(f.model.doStreamCalls);
    expect(prompts).toContain("PUBLIC_REFERENCE_BODY");
    expect(prompts).not.toContain("CANARY_SERVICE_KEY_NOT_MODEL_DATA");
  });
  it("编造外部来源不能发送成功终态或未审查文本", async () => {
    const f = fixture("参考[编造来源](https://fake.example.com/)");
    const body = await (await f.request()).text();
    expect(body).toContain("event: error"); expect(body).not.toContain("event: done");
    expect(body).not.toContain("fake.example.com");
    expect(f.order.slice(0, 3)).toEqual(["search", "read", "answer"]);
  });
});
