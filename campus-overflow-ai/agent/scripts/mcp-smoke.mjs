// MCP 外部接入冒烟（P4）：ListTools + 三个只读工具 + 未注册工具越权用例。
// 用法：
//   npm run smoke:mcp -- --in-process          # 本地起一个带桩数据的 MCP 实例跑通
//   MCP_SMOKE_TOKEN=xxx npm run smoke:mcp      # 对已启动的 MCP 实例（默认 127.0.0.1:8790/mcp）冒烟
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const READ_ONLY_TOOLS = ["search_questions", "search_courses", "list_tags"];
const inProcess = process.argv.includes("--in-process");

const callText = (result) =>
  result.content.map((item) => (item.type === "text" ? item.text : "")).join("");

/** 起本地实例：真实 HTTP 传输 + 只读工具注册表 + 桩后端数据，不依赖 FastAPI */
const startInProcess = async () => {
  const { startMcpHttpServer } = await import("../src/mcp/http.ts");
  const { createMcpSessionFactory } = await import("../src/mcp/session.ts");
  const { McpToolRegistry } = await import("../src/mcp/registry.ts");
  const { ensureReadOnlyMcpTools } = await import("../src/mcp/tools.ts");

  const backendStub = {
    searchQuestions: async () => [{ id: 1, title: "冒烟问题", courseId: 1 }],
    searchCourses: async () => [{ id: 1, name: "冒烟课程", code: "SMOKE" }],
    fetchTags: async () => [{ id: 1, name: "冒烟标签", type: "tech" }],
  };
  const activeToken = "smoke-active-token";
  const expiredToken = "smoke-expired-token";
  const registry = new McpToolRegistry();
  ensureReadOnlyMcpTools(registry, backendStub);
  const audit = { record: () => undefined, recordRejected: () => undefined };
  const handle = await startMcpHttpServer({
    clients: [
      {
        name: "smoke-client",
        scopes: ["read"],
        tokens: [{ token: activeToken }],
        externalKey: activeToken,
      },
      {
        name: "smoke-expired-client",
        scopes: ["read"],
        tokens: [{ token: expiredToken, expiresAt: Date.now() - 1_000 }],
        externalKey: expiredToken,
      },
    ],
    sessionFactory: createMcpSessionFactory({ registry, audit }),
    audit,
  }, 0);
  return {
    url: `http://127.0.0.1:${handle.port}/mcp`,
    token: activeToken,
    expiredToken,
    close: handle.close,
  };
};

const postWithToken = (url, token) => fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});

const runChecks = async ({ url, token, expiredToken }) => {
  const invalid = await postWithToken(url, "smoke-invalid-token");
  assert.equal(invalid.status, 401, "未知凭证应返回 401");
  assert.ok((await invalid.json()).message.includes("MCP 凭证"));

  if (expiredToken) {
    const expired = await postWithToken(url, expiredToken);
    assert.equal(expired.status, 401, "过期凭证应返回 401");
  }

  const client = new Client({ name: "mcp-smoke", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    for (const name of READ_ONLY_TOOLS) {
      assert.ok(names.includes(name), `ListTools 缺少只读工具 ${name}`);
    }

    const questions = await client.callTool({
      name: "search_questions", arguments: { keyword: "冒烟", limit: 1 },
    });
    assert.equal(questions.isError, false, `search_questions 失败：${callText(questions)}`);

    const courses = await client.callTool({
      name: "search_courses", arguments: { keyword: "冒烟", limit: 1 },
    });
    assert.equal(courses.isError, false, `search_courses 失败：${callText(courses)}`);

    const tags = await client.callTool({ name: "list_tags", arguments: { limit: 1 } });
    assert.equal(tags.isError, false, `list_tags 失败：${callText(tags)}`);

    const unregistered = await client.callTool({
      name: "mcp_smoke_unregistered_tool", arguments: {},
    });
    assert.equal(unregistered.isError, true, "未注册工具必须被拒绝");
    assert.ok(callText(unregistered).includes("工具未注册"));
  } finally {
    await client.close();
  }
};

const local = inProcess ? await startInProcess() : null;
const url = local?.url ?? process.env.MCP_SMOKE_URL
  ?? `http://127.0.0.1:${process.env.MCP_PORT ?? 8790}/mcp`;
const token = local?.token ?? process.env.MCP_SMOKE_TOKEN;
try {
  assert.ok(token, "非 --in-process 模式需要设置 MCP_SMOKE_TOKEN");
  await runChecks({ url, token, expiredToken: local?.expiredToken });
  console.log(`MCP smoke passed: ${url}（ListTools、三个只读工具、未注册工具拒绝${local ? "、过期凭证 401" : ""}）`);
} finally {
  await local?.close();
}
