"use client";

import { Button } from "@/shared/components";
import type { Comment } from "@/shared/types/comment";

import { timeAgo } from "@/features/questions/timeAgo";

export interface DeletableComment {
  id: number;
  author: string;
}

// 评论列表（§2.7）：顶级评论 + 二级回复缩进（border-l 引导线）展示
// 删除入口仅评论作者或管理员可见（越权不渲染），确认弹窗由父级统一处理
export function CommentList({
  items,
  canDelete,
  onRequestDelete,
}: {
  items: Comment[];
  canDelete: (author: string) => boolean;
  onRequestDelete: (target: DeletableComment) => void;
}) {
  if (items.length === 0) {
    return <p className="text-[12px] text-ink-subtle">还没有评论</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-line">
      {items.map((comment) => (
        <li key={comment.id} className="py-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] text-ink">
                <span className="font-medium">{comment.author}</span>
                <span className="ml-2 text-[12px] text-ink-subtle">{timeAgo(comment.created_at)}</span>
              </p>
              <p className="mt-0.5 break-words text-[13px] leading-relaxed text-ink-muted">
                {comment.body}
              </p>
            </div>
            {canDelete(comment.author) ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`删除 ${comment.author} 的评论`}
                onClick={() => onRequestDelete(comment)}
              >
                删除
              </Button>
            ) : null}
          </div>

          {comment.replies.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-2 border-l-2 border-line pl-3">
              {comment.replies.map((reply) => (
                <li key={reply.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[13px] text-ink">
                      <span className="font-medium">{reply.author}</span>
                      <span className="ml-2 text-[12px] text-ink-subtle">{timeAgo(reply.created_at)}</span>
                    </p>
                    <p className="mt-0.5 break-words text-[13px] leading-relaxed text-ink-muted">
                      {reply.body}
                    </p>
                  </div>
                  {canDelete(reply.author) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`删除 ${reply.author} 的回复`}
                      onClick={() => onRequestDelete(reply)}
                    >
                      删除
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
