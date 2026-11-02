import { expect, it } from "vitest";
import { WORKFLOW_SERIALIZE, WORKFLOW_DESERIALIZE } from "@workflow/serde";
import { GovernanceWorkflowModel } from "../src/workflows/governance-model.js";

it("持久模型描述符不包含provider密钥或连接配置", () => {
  const serialized = GovernanceWorkflowModel[WORKFLOW_SERIALIZE]();
  expect(serialized).toEqual({});
  expect(GovernanceWorkflowModel[WORKFLOW_DESERIALIZE]().provider).toBe("campus.governance");
});
