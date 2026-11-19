import { z } from "zod";
import { createWorkflowClient, WorkflowApiError } from "../workflow-client.js";
import { dispatchGovernanceTask, resumeUnboundGovernanceTasks } from "../workflow-dispatch.js";

const PageSchema = z.object({ revision: z.number().int().nonnegative(), has_more: z.boolean(),
  items: z.array(z.object({ target_type: z.enum(["question", "answer", "comment"]), target_id: z.number().int().positive() })).max(100) });

export const runWorkflowPatrol = async () => {
  const outcome = { scanned: 0, escalated: 0, skipped: 0, failed: 0 };
  try { await resumeUnboundGovernanceTasks(); }
  catch { console.error(JSON.stringify({ event: "patrol_reconcile_unavailable" })); }
  const client = createWorkflowClient();
  try {
    for (let pageCount = 0; pageCount < 10; pageCount++) {
      const page = PageSchema.parse(await client.request("/scan/page"));
      let failed = false;
      for (const target of page.items) {
        outcome.scanned++;
        try { await dispatchGovernanceTask(target); outcome.escalated++; }
        catch (error) {
          // 获取后已隐藏/删除的目标无需启动；其他失败保留本页，不能越过遗漏。
          if (error instanceof WorkflowApiError && error.status === 409 && error.reasonCode === "patrol_target_unavailable") outcome.skipped++;
          else { outcome.failed++; failed = true; }
        }
      }
      if (failed) break;
      await client.request("/scan/page", { revision: page.revision });
      if (!page.has_more) break;
    }
  } catch { outcome.failed++; console.error(JSON.stringify({ event: "patrol_scan_failed" })); }
  return outcome;
};
