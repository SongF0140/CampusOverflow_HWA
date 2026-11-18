import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequestTools } from "../src/tools/request-tools.js";
import type { AgentPrincipal } from "../src/auth/principal.js";
import type { UserInternalClient } from "../src/internal-client.js";

const principal: AgentPrincipal = {
  user_id: 1, role: "student", status: "active", identity_type: "undergraduate", assistant_cert_status: "none",
};

afterEach(() => vi.unstubAllEnvs());

describe("公共工具按角色继承", () => {
  it.each(["student", "teacher", "admin"] as const)("%s继承同一只读网络工具，角色变更能力单独裁剪", role => {
    const current: AgentPrincipal = { ...principal, role };
    const tools = createRequestTools({} as UserInternalClient, current, undefined,
      { config: { enabled: true, browserEnabled: true, apiKey: "test-key" } });
    const names = tools.listTools().map(tool => tool.name);
    expect(names).toContain("searchWeb"); expect(names).toContain("readWebPage");
    expect(names.includes("proposeGovernance")).toBe(role === "admin");
    expect(names.includes("proposeClassMembership")).toBe(role !== "student");
  });

  it("RAG 开关开启且绑定课程时才注册 searchKnowledge", () => {
    vi.stubEnv("RAG_ENABLED", "true");
    const withCourse = createRequestTools({} as UserInternalClient, principal, 1).listTools().map(tool => tool.name);
    expect(withCourse).toContain("searchKnowledge");

    const withoutCourse = createRequestTools({} as UserInternalClient, principal, undefined).listTools().map(tool => tool.name);
    expect(withoutCourse).not.toContain("searchKnowledge");

    vi.stubEnv("RAG_ENABLED", "false");
    const disabled = createRequestTools({} as UserInternalClient, principal, 1).listTools().map(tool => tool.name);
    expect(disabled).not.toContain("searchKnowledge");
  });
});
