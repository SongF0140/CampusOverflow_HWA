// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

const context = (path: string[]) => ({ params: Promise.resolve({ path }) });

async function withinTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("等待流式响应超时")), 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BFF /api/agent/**", () => {
  it("上游未关闭时即返回路由响应，并逐块透传 SSE", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const upstream = new Response(stream, {
      status: 202,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
    });
    vi.stubGlobal("fetch", vi.fn(async () => upstream));
    const encoder = new TextEncoder();
    const first = encoder.encode("data: first\n\n");
    const second = encoder.encode("data: second\n\n");
    controller.enqueue(first);
    const pendingResponse = GET(
      new Request("http://localhost:3000/api/agent/agent/similar-questions"),
      context(["agent", "similar-questions"]),
    );
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const response = await withinTimeout(pendingResponse);
      expect(response.status).toBe(202);
      expect(response.body).toBe(upstream.body);
      reader = response.body!.getReader();
      expect(await withinTimeout(reader.read())).toEqual({ done: false, value: first });
      controller.enqueue(second);
      expect(await withinTimeout(reader.read())).toEqual({ done: false, value: second });
      expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
      expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
      expect(response.headers.get("x-accel-buffering")).toBe("no");
    } finally {
      controller.close();
      await withinTimeout(pendingResponse);
      if (reader) {
        await withinTimeout(reader.cancel());
        reader.releaseLock();
      }
    }
  });

  it.each([400, 401, 403, 500])("保留 JSON 错误响应及状态 %s", async (status) => {
    const payload = { code: status, data: null, message: "请求失败" };
    const upstream = Response.json(payload, { status });
    vi.stubGlobal("fetch", vi.fn(async () => upstream));

    const response = await GET(
      new Request("http://localhost:3000/api/agent/agent/runs/1"),
      context(["agent", "runs", "1"]),
    );

    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBeNull();
    expect(response.headers.get("x-accel-buffering")).toBeNull();
    expect(await response.json()).toEqual(payload);
  });

  it("保留 204 空响应体并沿用缺省 content-type", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));

    const response = await GET(
      new Request("http://localhost:3000/api/agent/agent/runs/1"),
      context(["agent", "runs", "1"]),
    );

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
    expect(response.headers.get("content-type")).toBe("application/json");
  });

  it("上游不可用时保持中文 503 JSON 响应", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));

    const response = await GET(
      new Request("http://localhost:3000/api/agent/agent/health"),
      context(["agent", "health"]),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: 503, data: null, message: "AI 服务暂不可用，请稍后重试",
    });
  });

  it.each(["GET", "HEAD", "POST"])("透传 %s 方法、路径、查询、正文和内容类型", async (method) => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ code: 200, data: null, message: "ok" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const body = method === "POST" ? "question=测试" : undefined;
    const request = new Request("http://localhost:3000/api/agent/agent/runs/7?limit=2&tag=a%20b", {
      method,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body,
    });

    const response = await (method === "POST" ? POST : GET)(request, context(["agent", "runs", "7"]));
    await response.text();

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(`${process.env.AGENT_ORIGIN ?? "http://localhost:8787"}/agent/runs/7?limit=2&tag=a%20b`);
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({
      method,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body,
      cache: "no-store",
    }));
  });

  it("缺少请求 content-type 时使用 application/json，断连信号传给上游", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ code: 200, data: null, message: "ok" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const abortController = new AbortController();
    const request = new Request("http://localhost:3000/api/agent/agent/health", {
      signal: abortController.signal,
    });
    const response = await GET(request, context(["agent", "health"]));
    await response.text();

    const init = fetchMock.mock.calls[0][1];
    expect(init?.headers).toEqual({ "content-type": "application/json" });
    expect(init?.signal).toBe(request.signal);
    abortController.abort();
    expect(init?.signal?.aborted).toBe(true);
  });
});
