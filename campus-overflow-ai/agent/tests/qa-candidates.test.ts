// 快照候选复核客户端：必须双凭证、只接受后端裁决结果、响应必须与请求一致。
import { describe, expect, it } from "vitest";

import { createInternalClient } from "../src/internal-client.js";
import { asTraceId } from "../src/types/index.js";

const trace = asTraceId("candidates-test");

const item = (id: number, courseId = 7) => ({
  id, title: `问题${id}`, course_id: courseId, status: "published",
  tag_ids: [], updated_at: "2026-11-01T00:00:00",
});

const clientOf = (
  data: unknown,
  capture?: (url: string, init?: RequestInit) => void,
  authorization: string | null = "Bearer user",
) => createInternalClient({
  baseUrl: "https://backend.test", token: "service",
  authorization: authorization ?? undefined,
  fetchImpl: async (input, init) => {
    capture?.(String(input), init);
    return Response.json({ code: 200, data, message: "ok" });
  },
});

describe("快照候选复核", () => {
  it("携带用户凭证与课程发送候选 id，并保持后端顺序", async () => {
    let url = "";
    let body: unknown;
    let headers: Headers | undefined;
    const client = clientOf({ items: [item(2), item(1)], total: 2 }, (input, init) => {
      url = input;
      body = JSON.parse(String(init?.body));
      headers = new Headers(init?.headers);
    });

    const items = await client.fetchQaCandidates({ ids: [2, 1], courseId: 7 }, trace);

    expect(items.map(entry => entry.id)).toEqual([2, 1]);
    expect(url).toContain("/internal/agent/user/qa-index/candidates");
    expect(body).toEqual({ ids: [2, 1], course_id: 7 });
    expect(headers?.get("X-Service-Token")).toBe("service");
    expect(headers?.get("authorization")).toBe("Bearer user");
  });

  it("拒绝未请求的 id、错课程与不一致的 total", async () => {
    await expect(clientOf({ items: [item(3)], total: 1 })
      .fetchQaCandidates({ ids: [1] }, trace)).rejects.toThrow("候选复核响应与请求不一致");
    await expect(clientOf({ items: [item(1, 8)], total: 1 })
      .fetchQaCandidates({ ids: [1], courseId: 7 }, trace)).rejects.toThrow("候选复核响应与请求不一致");
    await expect(clientOf({ items: [item(1)], total: 2 })
      .fetchQaCandidates({ ids: [1] }, trace)).rejects.toThrow("候选复核响应与请求不一致");
  });

  it("缺少用户凭证时直接拒绝，不退回服务身份", async () => {
    const client = clientOf({ items: [], total: 0 }, undefined, null);
    await expect(client.fetchQaCandidates({ ids: [1] }, trace)).rejects.toThrow("需要用户登录凭证");
  });

  it("候选数量超过上限时拒绝", async () => {
    const ids = Array.from({ length: 51 }, (_, index) => index + 1);
    await expect(clientOf({ items: [], total: 0 })
      .fetchQaCandidates({ ids }, trace)).rejects.toThrow();
  });
});
