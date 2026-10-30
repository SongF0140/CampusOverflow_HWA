import { describe, expect, it } from "vitest";
import { createInternalClient } from "../src/internal-client.js";
import { asTraceId } from "../src/types/index.js";

const trace = asTraceId("contract-test");
const client = (data: unknown) => createInternalClient({ baseUrl: "https://backend.test", token: "service", authorization: "Bearer user",
  fetchImpl: async () => Response.json({ code: 200, data, message: "ok" }) });

describe("上下文响应关联校验", () => {
  it.each([
    { id: 1, tag_id: 1, course_id: 8, active: true },
    { id: 2, tag_id: 1, course_id: 7, active: true },
    { id: 1, tag_id: 1, course_id: 7, active: false },
  ])("拒绝错课、错标签或失效标签 %j", async fields => {
    await expect(client([{ name: "真实标签", source: "teacher", ...fields }]).fetchTrustedTags(7, trace)).rejects.toThrow();
  });
  it("拒绝其他课程已发布经验", async () => {
    await expect(client([{ id: crypto.randomUUID(), course_id: 8, title: "经验", summary: "摘要", steps: [], status: "published" }])
      .fetchPublishedExperiences(7, trace)).rejects.toThrow();
  });
  it("认证答案回显ID错配必须拒绝", async () => {
    await expect(client({ answer_id: 2, question_id: 1, course_id: 7, certified: true, visible: true, url: "/questions/1#answer-2" })
      .verifyCertifiedAnswer(1, trace)).rejects.toThrow();
  });
});
