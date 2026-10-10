"use client";

import { useState } from "react";

import { createAnswerComment, listAnswerComments } from "@/api/comments";
import { CommentSection } from "@/features/comments/CommentSection";
import { timeAgo } from "@/features/questions/timeAgo";
import {
  Avatar,
  Button,
  ConfirmDialog,
  MarkdownView,
  VoteWidget,
  type ToastTone,
  type VoteDirection,
} from "@/shared/components";
import type { Answer } from "@/shared/types/answer";

import { AnswerEditor } from "./AnswerEditor";

type PendingAction = "accept" | "delete" | "certify" | "recommend" | null;
type DialogKind = "accept" | "delete" | null;

// 回答卡（§2.7）：Markdown 正文 + 竖排投票 + 徽标行 + 条件渲染操作组 + 折叠评论区
// 数据更新全部由父级 AnswerList 处理（本地 patch 或重拉），本组件只负责展示与回调
export function AnswerCard({
  answer,
  canAccept,
  viewerUsername,
  isAdmin,
  isTeacher,
  isAssistant,
  isLoggedIn,
  onNeedLogin,
  onVote,
  onAccept,
  onEdit,
  onDelete,
  onCertify,
  onRecommend,
  showToast,
}: {
  answer: Answer;
  // 提问者本人且问题未采纳时为 true（由父级按问题状态实时计算）
  canAccept: boolean;
  viewerUsername: string | null;
  isAdmin: boolean;
  isTeacher: boolean;
  isAssistant: boolean;
  isLoggedIn: boolean;
  onNeedLogin: () => void;
  onVote: (answer: Answer, direction: VoteDirection) => void;
  onAccept: (answer: Answer) => Promise<void>;
  onEdit: (answer: Answer, body: string) => Promise<boolean>;
  onDelete: (answer: Answer) => Promise<void>;
  onCertify: (answer: Answer, certify: boolean) => Promise<void>;
  onRecommend: (answer: Answer) => Promise<void>;
  showToast: (tone: ToastTone, message: string) => void;
}) {
  const isAnswerAuthor = viewerUsername !== null && viewerUsername === answer.author;
  // 编辑/删除 = 回答作者或管理员（越权不渲染）
  const canEditOrDelete = isAnswerAuthor || isAdmin;

  const [isEditing, setIsEditing] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  async function runAction(action: PendingAction, run: () => Promise<void>) {
    setPendingAction(action);
    try {
      await run();
    } finally {
      setPendingAction(null);
    }
  }

  async function handleEditSubmit(body: string): Promise<boolean> {
    const ok = await onEdit(answer, body);
    if (ok) setIsEditing(false);
    return ok;
  }

  const badges: Array<{ key: string; label: string; className: string }> = [];
  if (answer.is_accepted) {
    badges.push({ key: "accepted", label: "✓ 已采纳", className: "bg-success-soft text-success-ink" });
  }
  if (answer.certified_by_teacher) {
    badges.push({ key: "certified", label: "👑 优质内容", className: "bg-warning-soft text-warning-ink" });
  }
  if (answer.recommended_by_assistant) {
    badges.push({ key: "recommended", label: "助教推荐", className: "bg-brand-soft text-brand-strong" });
  }

  return (
    <article aria-label="回答" className="rounded-lg border border-line bg-canvas p-5">
      {badges.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {badges.map((badge) => (
            <span
              key={badge.key}
              className={`inline-flex items-center rounded-sm px-2 py-0.5 text-[12px] font-medium ${badge.className}`}
            >
              {badge.label}
            </span>
          ))}
        </div>
      ) : null}

      {isEditing ? (
        <AnswerEditor
          initialBody={answer.body}
          submitLabel="保存修改"
          onSubmit={handleEditSubmit}
          onCancel={() => setIsEditing(false)}
        />
      ) : (
        <div className="flex items-start gap-4">
          <VoteWidget
            score={answer.vote_score}
            myVote={answer.my_vote === 1 ? 1 : answer.my_vote === -1 ? -1 : 0}
            isLoggedIn={isLoggedIn}
            onNeedLogin={onNeedLogin}
            onVote={(direction) => onVote(answer, direction)}
          />
          <div className="min-w-0 flex-1">
            <MarkdownView content={answer.body} />
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        <div className="flex items-center gap-2 text-[12px] text-ink-subtle">
          {/* TODO(接口差异)：回答列表接口仅返回 author 用户名（无 id），与广场问题卡同款降级渲染 */}
          <span className="inline-flex items-center gap-1.5">
            <Avatar name={answer.author} size="sm" />
            <span className="font-medium text-ink">{answer.author}</span>
          </span>
          <span aria-hidden="true">·</span>
          <time dateTime={answer.created_at}>{timeAgo(answer.created_at)}</time>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canAccept && !answer.is_accepted ? (
            <Button size="sm" isLoading={pendingAction === "accept"} onClick={() => setDialog("accept")}>
              采纳
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={commentsOpen}
            onClick={() => setCommentsOpen((open) => !open)}
          >
            评论
          </Button>
          {canEditOrDelete ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
                编辑
              </Button>
              <Button variant="danger" size="sm" onClick={() => setDialog("delete")}>
                删除
              </Button>
            </>
          ) : null}
          {isTeacher ? (
            <Button
              variant="ghost"
              size="sm"
              isLoading={pendingAction === "certify"}
              onClick={() => void runAction("certify", () => onCertify(answer, !answer.certified_by_teacher))}
            >
              {answer.certified_by_teacher ? "取消认证" : "认证"}
            </Button>
          ) : null}
          {/* 助教推荐一次性：已推荐的回答不再出现推荐入口 */}
          {isAssistant && !answer.recommended_by_assistant ? (
            <Button
              variant="ghost"
              size="sm"
              isLoading={pendingAction === "recommend"}
              onClick={() => void runAction("recommend", () => onRecommend(answer))}
            >
              推荐
            </Button>
          ) : null}
        </div>
      </div>

      {commentsOpen ? (
        <div className="mt-3">
          <CommentSection
            label="回答评论"
            loadComments={() => listAnswerComments(answer.id, { page_size: 50 })}
            submitComment={(input) => createAnswerComment(answer.id, input)}
            viewerUsername={viewerUsername}
            isAdmin={isAdmin}
            isLoggedIn={isLoggedIn}
            showToast={showToast}
          />
        </div>
      ) : null}

      <ConfirmDialog
        open={dialog === "accept"}
        title="采纳回答"
        description="采纳后问题标记为已解决，并通知回答作者。"
        confirmLabel="采纳"
        onConfirm={() => {
          setDialog(null);
          void runAction("accept", () => onAccept(answer));
        }}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        title="删除回答"
        description="删除后不可恢复，确定要删除这个回答吗？"
        confirmLabel="删除"
        danger
        onConfirm={() => {
          setDialog(null);
          void runAction("delete", () => onDelete(answer));
        }}
        onCancel={() => setDialog(null)}
      />
    </article>
  );
}
