"use client";

// 申诉处理（T-15-D 接真实数据）：状态筛选 + 申诉表 + 行内复核。
// 数据源 GET /api/governance/appeals；复核 POST resolve（accepted 撤销处置 /
// rejected 维持），撤销类操作经 ConfirmDialog 二次确认；结果通知当事人（后端同事务）。
import { useState } from "react";

import { fetchAppeals, resolveAppeal } from "@/api/governance";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Select,
  Toast,
  type ToastTone,
} from "@/shared/components";
import { toErrorMessage, useAsyncData } from "@/shared/hooks/useAsyncData";
import type { AppealItem } from "@/shared/types/governance";

const STATUS_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待处理" },
  { value: "accepted", label: "已撤销处置" },
  { value: "rejected", label: "已维持处置" },
];

const STATUS_LABELS: Record<string, string> = {
  pending: "待处理", accepted: "已撤销处置", rejected: "已维持处置",
};

export function AppealsAdminView() {
  const [status, setStatus] = useState("pending");
  const [toast, setToast] = useState<{ tone: ToastTone; message: string } | null>(null);
  const [confirming, setConfirming] = useState<AppealItem | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const state = useAsyncData(
    () => fetchAppeals({
      status: status === "all" ? undefined : status,
      page: 1,
      page_size: 50,
    }),
    [status],
  );
  const appeals = state.data?.items ?? [];

  async function handleResolve(resolution: "accepted" | "rejected") {
    if (!confirming) return;
    setBusy(true);
    try {
      await resolveAppeal(confirming.id, {
        resolution,
        resolution_note: note.trim() || (resolution === "accepted" ? "复核属实，撤销处置" : "经复核维持原处置"),
      });
      setToast({
        tone: "success",
        message: resolution === "accepted" ? "已撤销处置并通知当事人" : "已维持处置并通知当事人",
      });
      setConfirming(null);
      setNote("");
      state.reload();
    } catch (caught) {
      setToast({ tone: "error", message: toErrorMessage(caught) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[22px] font-semibold text-ink">申诉处理</h2>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-[160px]">
          <Select
            label="状态"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            options={STATUS_OPTIONS}
          />
        </div>
      </div>

      {state.isLoading ? <LoadingSkeleton variant="detail" count={3} /> : null}
      {state.error !== null ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : null}

      {!state.isLoading && state.error === null ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-line bg-canvas">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line text-[12px] text-ink-subtle">
                  <th scope="col" className="py-3 pl-5 pr-4 font-medium">申诉人</th>
                  <th scope="col" className="py-3 pr-4 font-medium">关联工单</th>
                  <th scope="col" className="py-3 pr-4 font-medium">申诉理由</th>
                  <th scope="col" className="py-3 pr-4 font-medium">提交时间</th>
                  <th scope="col" className="py-3 pr-4 font-medium">状态</th>
                  <th scope="col" className="py-3 pr-4 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {appeals.map((item) => (
                  <tr key={item.id} className="border-b border-line-subtle text-[13px]">
                    <td className="py-3 pl-5 pr-4">用户 #{item.user_id}</td>
                    <td className="py-3 pr-4">工单 #{item.case_id}</td>
                    <td className="max-w-[280px] truncate py-3 pr-4" title={item.reason}>
                      {item.reason}
                    </td>
                    <td className="py-3 pr-4">
                      {new Date(item.created_at).toLocaleString("zh-CN")}
                    </td>
                    <td className="py-3 pr-4">{STATUS_LABELS[item.status] ?? item.status}</td>
                    <td className="py-3 pr-4">
                      {item.status === "pending" ? (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setConfirming(item);
                            setNote("");
                          }}
                        >
                          复核
                        </Button>
                      ) : (
                        <span className="text-ink-subtle">
                          {item.resolution_note ?? "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {appeals.length === 0 ? (
            <EmptyState
              title="暂无申诉"
              description="当前筛选条件下没有申诉。被处置用户提交申诉后会出现在此处。"
            />
          ) : null}
        </>
      ) : null}

      {confirming !== null ? (
        <div className="rounded-lg border border-line bg-canvas p-4">
          <label className="text-[13px] font-medium text-ink" htmlFor="appeal-note">
            复核说明（将通知当事人）
          </label>
          <textarea
            id="appeal-note"
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 500))}
            placeholder="可选；留空时使用默认文案"
            rows={2}
            className="mt-2 w-full rounded border px-3 py-2 text-sm"
            disabled={busy}
          />
        </div>
      ) : null}

      {toast !== null && (
        <Toast tone={toast.tone} message={toast.message} onClose={() => setToast(null)} />
      )}
      {confirming !== null && (
        <ConfirmDialog
          open
          danger
          title={`复核申诉 #${confirming.id}`}
          description={`撤销处置将同时恢复内容可见或解禁该用户，结果将通知当事人。${
            note.trim() ? `复核说明：${note.trim()}` : "可在撤销前在下方填写说明，或直接取消后重新填写。"
          }`}
          confirmLabel="撤销处置"
          cancelLabel="维持处置"
          onConfirm={() => void handleResolve("accepted")}
          onCancel={() => void handleResolve("rejected")}
        />
      )}
    </div>
  );
}
