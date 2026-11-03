import { describe, expect, it, vi } from "vitest";
import { fetchPublicPage, isPublicIp, parsePublicUrl } from "../src/web/public-fetch.js";

describe("公开网页获取边界", () => {
  it.each(["http://127.0.0.1/", "https://[::1]/", "https://user:pass@example.com/", "file:///etc/passwd", "https://localhost/", "https://localhost./", "https://2130706433/", "https://a.local/", "https://example.com:8000/", "https://example.com/?api_key=secret"])("拒绝非法/内网目标 %s", url => {
    expect(() => parsePublicUrl(url)).toThrow();
  });
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1"])("拒绝保留地址 %s", address => {
    expect(isPublicIp(address)).toBe(false);
  });
  it("接受公开地址和规范URL", () => {
    expect(isPublicIp("8.8.8.8")).toBe(true);
    expect(parsePublicUrl("https://example.com/a#section").href).toBe("https://example.com/a");
  });
  it("DNS包含私网地址时不发请求", async () => {
    const request = vi.fn();
    await expect(fetchPublicPage("https://example.com/", undefined, {
      lookup: async () => [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }], request,
    })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("请求使用已校验的固定地址，重定向重新解析并拒绝私网", async () => {
    const lookup = vi.fn().mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }]).mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }]);
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: "https://redirect.example.com/" } }));
    await expect(fetchPublicPage("https://example.com/", undefined, { lookup, request })).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toEqual({ address: "8.8.8.8", family: 4 });
  });
  it("响应仅接受有界文本", async () => {
    const lookup = async () => [{ address: "8.8.8.8", family: 4 }];
    await expect(fetchPublicPage("https://example.com/", undefined, { lookup, request: async () => new Response("a".repeat(600_000), { headers: { "content-type": "text/html" } }) })).rejects.toThrow();
    await expect(fetchPublicPage("https://example.com/", undefined, { lookup, request: async () => new Response("bytes", { headers: { "content-type": "application/octet-stream" } }) })).rejects.toThrow();
  });
  it("取消后不解析DNS或请求", async () => {
    const lookup = vi.fn(); const request = vi.fn();
    await expect(fetchPublicPage("https://example.com/", AbortSignal.abort(), { lookup, request })).rejects.toThrow();
    expect(lookup).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
  });
});
