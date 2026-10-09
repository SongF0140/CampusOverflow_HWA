"use client";

import { useState } from "react";

import { deleteComment } from "@/api/comments";
import { ConfirmDialog, type ToastTone } from "@/shared/components";
import { toErrorMessage, useAsyncData } from "@/shared/hooks/useAsyncData";
import type { CommentCreateInput, CommentListResult } from "@/shared/types/comment";

import { CommentForm } from "./CommentForm";
import { CommentList, type DeletableComment } from "./CommentList";

// 评论区容器（§2.7，问题与回答共用）：评论列表 + 发表输入 + 删除二次确认
// 发表/删除成功后重拉当前评论列表（最小重拉），失败 Toast 后端中文 message
export function CommentSection({
  label,
  loadComments,
  submitComment,
  viewerUsername,
  isAdmin,
  isLoggedIn,
  showToast,
}: {
  label: string;
  loadComments: () => Promise<CommentListResult>;
  submitComment: (input: CommentCreateInput) => Promise<unknown>;
  viewerUsername: string | null;
  isAdmin: boolean;
  isLoggedIn: boolean;
  showToast: (tone: ToastTone, message: string) => void;
}) {
  const { data, isLoading, error, reload } = useAsyncData(loadComments, []);
  const [pendingDelete, setPendingDelete] = useState<DeletableComment | null>(null);

  // 删除权限：评论作者本人或管理员
  const canDelete = (author: string): boolean =>
    viewerUsername !== null && (author === viewerUsername || isAdmin);

  async function handleSubmit(body: string): Promise<boolean> {
    try {
      await submitComment({ body });
      reload();
      return true;
    } catch (caught) {
      showToast("error", toErrorMessage(caught));
      return false;
    }
  }

  async function handleDeleteConfirm() {
    if (pendingDelete === null) return;
    try {
      await deleteComment(pendingDelete.id);
      reload();
    } catch (caught) {
      showToast("error", toErrorMessage(caught));
    } finally {
      setPendingDelete(null);
    }
  }

  return (
    <section aria-label={label} className="mt-4 border-t border-line pt-3">
      <h3 className="text-[13px] font-semibold text-ink-muted">{label}</h3>

      <div className="mt-2">
        {isLoading ? (
          <div className="flex flex-col gap-2" role="status" aria-live="polite">
            <span className="sr-only">正在加载评论</span>
            <div className="co-skeleton h-4 w-3/4 rounded-sm" />
            <div className="co-skeleton h-4 w-1/2 rounded-sm" />
          </div>
        ) : null}
        {error !== null ? (
          <p role="alert" className="text-[12px] text-danger-ink">
            {error}
          </p>
        ) : null}
        {!isLoading && error === null && data !== null ? (
          <CommentList items={data.items} canDelete={canDelete} onRequestDelete={setPendingDelete} />
        ) : null}
      </div>

      {/* 越权入口不渲染：游客只显示提示，不出输入框 */}
      {isLoggedIn ? (
        <CommentForm onSubmit={handleSubmit} />
      ) : (
        <p className="mt-3 text-[12px] text-ink-subtle">登录后可参与评论</p>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除评论"
        description="删除后不可恢复，确定删除这条评论吗？"
        confirmLabel="删除"
        danger
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
}
