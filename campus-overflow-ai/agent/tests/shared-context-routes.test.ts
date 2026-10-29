import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";

describe("共享上下文生产路由", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const client = {
    resolvePrincipal: vi.fn(async () => ({ user_id: 1, role: "student", status: "active", identity_type: "undergraduate", assistant_cert_status: "none" })),
    fetchTrustedTags: vi.fn(async () => [{ id: 3, tag_id: 3, name: "课程标签", course_id: 2, source: "teacher", active: true }]),
    fetchPublishedExperiences: vi.fn(async () => [{ id, course_id: 2, status: "published", title: "分步解释", summary: "先定义后举例", steps: ["只在详情披露的具体步骤"] }]),
  };
  const app = createApp({ createClient: () => client as never });
  const headers = { authorization: "Bearer user" };
  it("课程范围后端校验，经验索引不含步骤", async () => {
    const response = await app.request("/agent/main-memory?course_id=2", { headers });
    expect(response.status).toBe(200);
    expect(client.fetchTrustedTags).toHaveBeenCalled();
    const payload = await response.json();
    expect(payload.data.experiences[0]).toEqual({ id, title: "分步解释" });
    expect(JSON.stringify(payload)).not.toContain("只在详情披露");
  });
  it("选定索引后才披露已发布经验详情", async () => {
    const response = await app.request(`/agent/main-memory?course_id=2&level=detail&ids=${id}`, { headers });
    expect(await response.text()).toContain("只在详情披露的具体步骤");
  });
  it("可信标签接口不调用模型，也不创建标签", async () => {
    const response = await app.request("/agent/courses/2/trusted-tags", { headers });
    expect(response.status).toBe(200);
    expect((await response.json()).data[0].name).toBe("课程标签");
  });
  it("教师发布经验更新会改变共享上下文版本", async () => {
    const first = await (await app.request("/agent/main-memory?course_id=2", { headers })).json();
    client.fetchPublishedExperiences.mockResolvedValueOnce([{ id, course_id: 2, status: "published", title: "新流程", summary: "老师新发布", steps: ["先核对条件"] }]);
    const next = await (await app.request("/agent/main-memory?course_id=2", { headers })).json();
    expect(next.data.version).not.toBe(first.data.version);
  });
});
