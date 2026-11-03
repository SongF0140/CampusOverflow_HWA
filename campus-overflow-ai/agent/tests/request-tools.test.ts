import { describe, expect, it } from "vitest";
import { createRequestTools } from "../src/tools/request-tools.js";
import type { AgentPrincipal } from "../src/auth/principal.js";
import type { UserInternalClient } from "../src/internal-client.js";

describe("公共工具按角色继承", () => {
  it.each(["student", "teacher", "admin"] as const)("%s继承同一只读网络工具，角色变更能力单独裁剪", role => {
    const principal: AgentPrincipal = { user_id: 1, role, status: "active", identity_type: "undergraduate", assistant_cert_status: "none" };
    const tools = createRequestTools({} as UserInternalClient, principal, undefined,
      { config: { enabled: true, browserEnabled: true, apiKey: "test-key" } });
    const names = tools.listTools().map(tool => tool.name);
    expect(names).toContain("searchWeb"); expect(names).toContain("readWebPage");
    expect(names.includes("proposeGovernance")).toBe(role === "admin");
    expect(names.includes("proposeClassMembership")).toBe(role !== "student");
  });
});
