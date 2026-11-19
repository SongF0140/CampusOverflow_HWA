import { describe, expect, it } from "vitest";
import { extractWithBrowser } from "../src/web/browser-reader.js";

describe("agent-browser只读适配", () => {
  it("CLI只看到一次性本地正文，不继承凭据或真实网页登录态", async () => {
    const result = await extractWithBrowser({ url: "https://example.com/article", body: "<html><body><p>公开文本</p><script>fetch('https://evil.example.com')</script><iframe src='http://127.0.0.1/'></iframe></body></html>", contentType: "text/html" }, undefined, async invocation => {
      if (invocation.args.includes("close")) return JSON.stringify({ success: true, data: { closed: true } });
      expect(invocation.args).toContain("read");
      expect(invocation.args).not.toContain("open");
      const bridge = invocation.args[invocation.args.indexOf("read") + 1];
      expect(bridge).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9-]+$/);
      expect(await (await fetch(bridge)).text()).toBe("公开文本");
      expect((await fetch(new URL("/other", bridge))).status).toBe(404);
      expect(Object.keys(invocation.env).sort()).toEqual(["PATH", "SystemRoot", "TEMP", "TMP", "WINDIR", "AGENT_BROWSER_SOCKET_DIR"].sort());
      expect(invocation.args).toContain("--require-md");
      return JSON.stringify({ success: true, data: { content: "公开文本", source: "accept-markdown" } });
    });
    expect(result).toEqual({ url: "https://example.com/article", content: "公开文本" });
  });
  it("CLI错误只返回静态摘要", async () => {
    await expect(extractWithBrowser({ url: "https://example.com/", body: "text", contentType: "text/plain" }, undefined,
      async () => { throw new Error("secret-provider-details"); })).rejects.toThrow("网页正文读取失败");
  });
});
