"use client";

// 编辑问题面板（页面控件级设计说明 §2.8）：复用 QuestionForm 预填标题/正文/课程/标签；
// 后端 PATCH /questions/{id} 仅收 title/body 且仅作者可调用 → 课程/标签锁定只读，
// 删除走 ConfirmDialog 二次确认（作者或管理员）→ 成功回广场
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { deleteQuestion, getQuestion, updateQuestion } from "@/api/questions";
import { ApiError } from "@/api/client";
import {
  Button,
  ConfirmDialog,
  ErrorState,
  LoadingSkeleton,
} from "@/shared/components";
import { useSessionStore } from "@/shared/stores/session-store";
import { toErrorMessage } from "@/shared/hooks/useAsyncData";
import type { QuestionDetail, QuestionRecord } from "@/shared/types/question";

import { QuestionMissing } from "./QuestionDetailView";
import { QuestionForm } from "./QuestionForm";

type EditFailure = "notfound" | "generic";

export function EditQuestionPanel({ questionId }: { questionId: number }) {
  const router = useRouter();
  const me = useSessionStore((state) => state.me);
  const sessionStatus = useSessionStore((state) => state.status);

  const [question, setQuestion] = useState<QuestionDetail | null>(null);
  const [failure, setFailure] = useState<EditFailure | null>(null);
  const [failureMessage, setFailureMessage] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getQuestion(questionId)
      .then((data) => {
        if (active) setQuestion(data);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof ApiError && caught.code === 404) {
          setFailure("notfound");
        } else {
          setFailure("generic");
          setFailureMessage(toErrorMessage(caught));
        }
      });
    return () => {
      active = false;
    };
  }, [questionId, reloadToken]);

  async function handleDelete(): Promise<void> {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteQuestion(questionId);
      setIsDeleteDialogOpen(false);
      router.push("/");
    } catch (caught) {
      // 删除失败（如 403）留在编辑页展示原因
      setDeleteError(toErrorMessage(caught));
      setIsDeleteDialogOpen(false);
    } finally {
      setIsDeleting(false);
    }
  }

  if (failure === "notfound") {
    return <QuestionMissing />;
  }
  if (failure === "generic") {
    return (
      <ErrorState
        message={failureMessage}
        onRetry={() => {
          setFailure(null);
          setReloadToken((token) => token + 1);
        }}
      />
    );
  }
  if (question === null) {
    return <LoadingSkeleton variant="detail" count={2} />;
  }

  // 后端 PATCH 仅作者可编辑（管理员也只有删除权），与详情页作者判定口径一致
  const isAuthor = me?.username === question.author;
  if (!isAuthor) {
    // session 尚在加载（middleware 已保证有 token）→ 等待，避免误判 403
    if (sessionStatus === "loading") {
      return <LoadingSkeleton variant="detail" count={2} />;
    }
    return (
      <div className="flex flex-col gap-3">
        <ErrorState message="只有作者可以编辑该问题" />
        <Link
          href={`/questions/${questionId}`}
          className="co-focusable self-start text-[13px] text-ink-muted underline-offset-2 transition-colors duration-150 ease-standard hover:text-ink hover:underline"
        >
          返回问题详情
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="面包屑" className="text-[13px] text-ink-subtle">
        <Link
          href={`/questions/${questionId}`}
          className="co-focusable transition-colors duration-150 ease-standard hover:text-ink"
        >
          问题详情
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-muted">编辑</span>
      </nav>

      <h1 className="text-[20px] font-semibold text-ink">编辑问题</h1>

      <QuestionForm<QuestionRecord>
        draftKey={`co_draft_edit_question_${questionId}`}
        lockCourse
        lockTags
        initialValues={{
          title: question.title,
          content: question.body,
          course_id: question.course_id,
          tags: question.tags.map((tag) => ({ id: tag.id, name: tag.name })),
        }}
        submitLabel="保存修改"
        pendingLabel="保存中…"
        successToast="修改已保存"
        onSubmit={async (values) =>
          updateQuestion(questionId, { title: values.title, body: values.body })
        }
        onSuccess={() => router.push(`/questions/${questionId}`)}
        onCancel={() => router.push(`/questions/${questionId}`)}
      />

      <div className="border-t border-line pt-4">
        <Button variant="danger" onClick={() => setIsDeleteDialogOpen(true)}>
          删除问题
        </Button>
        {deleteError ? (
          <p className="mt-2 text-[12px] text-danger-ink" role="alert">
            {deleteError}
          </p>
        ) : null}
      </div>

      <ConfirmDialog
        open={isDeleteDialogOpen}
        danger
        title="确认删除该问题？"
        description="删除后问题与全部回答将不再可见，此操作无法撤销。"
        confirmLabel={isDeleting ? "删除中…" : "确认删除"}
        onConfirm={handleDelete}
        onCancel={() => setIsDeleteDialogOpen(false)}
      />
    </div>
  );
}
