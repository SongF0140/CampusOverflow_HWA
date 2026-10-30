import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSessionStore } from "@/shared/stores/session-store";
import type { UserMe } from "@/shared/types/auth";
import { GovernanceApprovalV2Panel } from "./GovernanceApprovalV2Panel";

const requestId = "00000000-0000-4000-8000-000000000001";
const item = { request_id: requestId, case_id: 1, contract_version: 2, requester_id: 1,
  source_kind: "admin", args_hash: "a".repeat(64), status: "pending", executed: false,
  approved_by: null, approved_at: null, expires_at: "2099-11-05T00:00:00Z", execution_id: null,
  execution_state: null, continuation: null,
  frozen_call: { target_type: "question", target_id: 2, action: "delete", reason: "垃圾内容", duration_days: null,
    expected_version: "b".repeat(64), tool_name: "executeApprovedGovernance" }, trace_id: "t", agent_run_id: `approval-${requestId}` };
beforeEach(() => { useSessionStore.setState({ me: { id: 1, role: "admin" } as UserMe }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useSessionStore.setState({ me: null }); });

it("弹窗确认前零批准，批准只发approve且不能显示治理成功", async () => {
  const calls: string[] = [];
  const http = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") { calls.push(url); expect(JSON.parse(String(init.body)).args_hash).toBe(item.args_hash); }
    return Response.json({ code: 200, data: init?.method === "POST" ? { ...item, status: "approved", execution_state: "queued" } : item });
  });
  vi.stubGlobal("fetch", http);
  render(<GovernanceApprovalV2Panel requestId={requestId} />);
  fireEvent.click(await screen.findByRole("button", { name: "批准此动作" }));
  expect(calls).toEqual([]);
  expect(screen.getByRole("dialog")).toHaveTextContent("删除");
  fireEvent.click(screen.getByRole("button", { name: "确认批准" }));
  await waitFor(() => expect(calls).toEqual([`/api/backend/api/governance/approval-requests/${requestId}/approve`]));
  expect(await screen.findByText("已批准，等待后台执行")).toBeInTheDocument();
  expect(screen.queryByText("治理成功")).toBeNull();
});

it("结果未知只提供核对，不重新批准或创建动作", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ code: 200, data: { ...item, status: "approved", execution_state: "result_unknown" } }));
  render(<GovernanceApprovalV2Panel requestId={requestId} />);
  expect(await screen.findByText("结果待核对，请勿重复处置")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "批准此动作" })).toBeNull();
});

it("退出账号后停止显示旧审批数据", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ code: 200, data: item }));
  render(<GovernanceApprovalV2Panel requestId={requestId} />);
  await screen.findByRole("button", { name: "批准此动作" });
  act(() => useSessionStore.setState({ me: null }));
  expect(screen.queryByText("垃圾内容")).toBeNull();
});

it("关闭弹窗不批准，切换申请不显示旧清单", async () => {
  const posts = vi.fn();
  vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") posts();
    return Response.json({ code: 200, data: item });
  });
  const { rerender } = render(<GovernanceApprovalV2Panel requestId={requestId} />);
  fireEvent.click(await screen.findByRole("button", { name: "批准此动作" }));
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(posts).not.toHaveBeenCalled();
  rerender(<GovernanceApprovalV2Panel requestId="00000000-0000-4000-8000-000000000009" />);
  expect(screen.queryByText("原因：垃圾内容")).toBeNull();
});
