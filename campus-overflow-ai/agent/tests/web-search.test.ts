import { describe, expect, it, vi } from "vitest";
import { searchTavily } from "../src/web/search.js";

describe("Tavily固定协议", () => {
  it("仅发送公开查询参数，密钥只在Authorization且禁用提供方自动答案", async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ results: [{ title: "来源", url: "https://example.com/", content: "资料" }] })));
    expect(await searchTavily("操作系统调度", "test-only-key", undefined, request as typeof fetch)).toHaveLength(1);
    const [url, options] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.tavily.com/search");
    expect(options.redirect).toBe("error");
    expect(options.headers).toMatchObject({ authorization: "Bearer test-only-key" });
    expect(JSON.parse(options.body as string)).toMatchObject({ query: "操作系统调度", include_answer: false, include_raw_content: false, max_results: 5 });
    expect(options.body).not.toContain("test-only-key");
  });
  it("错误响应/无效JSON不暴露提供方原文", async () => {
    await expect(searchTavily("query", "key", undefined, vi.fn(async () => new Response("provider-secret-detail")) as typeof fetch))
      .rejects.toThrow("网络搜索服务暂不可用");
  });
});
