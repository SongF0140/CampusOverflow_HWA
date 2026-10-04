"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { ApiError } from "@/api/client";
import { fetchCourseDetail } from "@/api/courses";
import { deleteQuestion, fetchQuestionDetail, updateQuestion } from "@/api/questions";
import { ConfirmDialog, ErrorState, LoadingSkeleton, TagChip } from "@/shared/components";
import { TITLE_MAX_LEN } from "@/shared/constants/domain";
import { useSessionStore } from "@/shared/stores/session-store";
import type { QuestionDetail } from "@/shared/types/question";
import { isAuthorOf } from "@/shared/utils/ownership";

type LoadStatus = "loading" | "ready" | "error";

const inputClass =
  "co-focusable w-full rounded-md border border-line bg-canvas px-3 py-2 text-[14px] text-ink transition-colors duration-150 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20";

export function EditQuestionForm({ questionId }: { questionId: number }) {
  const router = useRouter();
  const currentUser = useSessionStore((state) => state.user);
  const sessionStatus = useSessionStore((state) => state.status);
  const loadSession = useSessionStore((state) => state.load);

  const [detail, setDetail] = useState<QuestionDetail | null>(null);
  const [courseName, setCourseName] = useState<string | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setStatus("loading");
      try {
        const question = await fetchQuestionDetail(questionId);
        if (cancelled) return;
        setDetail(question);
        setTitle(question.title);
        setBody(question.body);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [questionId]);

  useEffect(() => {
    if (!detail) return;
    let cancelled = false;
    void (async () => {
      try {
        const course = await fetchCourseDetail(detail.course_id);
        if (!cancelled) setCourseName(course.name);
      } catch {
        if (!cancelled) setCourseName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) {
      setError("标题不能为空");
      return;
    }
    if (!body.trim()) {
      setError("问题描述不能为空");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const { message } = await updateQuestion(questionId, {
        title: title.trim(),
        body: body.trim(),
      });
      // 同发布页：只有后端提示里带「截断」时才作为 notice 展示（后端 PATCH 目前返回的是「发布成功」，
      // 因此不能拿具体文案做判断）
      const hasTruncationNotice = message.includes("截断");
      router.replace(
        hasTruncationNotice
          ? `/questions/${questionId}?notice=${encodeURIComponent(message)}`
          : `/questions/${questionId}`,
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "保存失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    setPending(true);
    setError(null);
    try {
      await deleteQuestion(questionId);
      setConfirmDelete(false);
      router.replace("/");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "删除失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  if (status === "loading") {
    return <LoadingSkeleton variant="detail" count={2} />;
  }

  if (status === "error" || !detail) {
    return <ErrorState message="问题加载失败，可能已被删除。" onRetry={() => router.refresh()} />;
  }

  // 渲染期派生"非作者"（登录态就绪后再判断；不在 effect 里 setState）
  // 前端先挡一道，后端仍会二次校验并返回 403
  const forbidden =
    sessionStatus === "ready" && !isAuthorOf(currentUser?.username, detail.author);

  if (forbidden) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-line bg-canvas p-6">
        <p className="text-[16px] font-semibold text-ink">只有提问者可以编辑这个问题</p>
        <p className="text-[13px] text-ink-muted">
          你可以回到问题详情页查看内容；如需修改请联系提问者或管理员。
        </p>
        <Link
          href={`/questions/${questionId}`}
          className="co-focusable rounded-md bg-brand px-4 py-2 text-[14px] font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-strong"
        >
          回到问题详情
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-5 rounded-lg border border-line bg-canvas p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-[22px] font-semibold text-ink">编辑问题</h1>
          <Link
            href={`/questions/${questionId}`}
            className="co-focusable text-[13px] text-ink-muted hover:text-brand"
          >
            取消并返回
          </Link>
        </div>

        {/* 后端 PATCH 只接受 title / body：课程与标签在此只读展示 */}
        <div className="flex flex-col gap-2 rounded-md border border-line bg-panel px-4 py-3">
          <p className="text-[12px] text-ink-muted">
            课程与标签暂不支持修改（后端编辑接口仅支持标题与正文）
          </p>
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
            <span>课程：{courseName ?? `课程 ${detail.course_id}`}</span>
            {detail.tags.length > 0 ? (
              <span className="flex flex-wrap items-center gap-1.5">
                标签：
                {detail.tags.map((tag) => (
                  <TagChip key={tag.id} label={tag.name} />
                ))}
              </span>
            ) : null}
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">
            标题
            <span className="ml-2 text-[12px] text-ink-subtle">
              {title.length}/{TITLE_MAX_LEN}
            </span>
          </span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={`${inputClass} h-11`}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">问题描述</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={10}
            className={`${inputClass} resize-y leading-relaxed`}
          />
        </label>

        {error ? (
          <p role="alert" className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger-ink">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="co-focusable cursor-pointer rounded-md border border-danger-line bg-canvas px-4 py-2 text-[14px] font-medium text-danger transition-colors duration-150 ease-standard hover:bg-danger-soft"
          >
            删除问题
          </button>
          <div className="flex gap-3">
            <Link
              href={`/questions/${questionId}`}
              className="co-focusable rounded-md border border-line bg-canvas px-4 py-2 text-[14px] font-medium text-ink transition-colors duration-150 ease-standard hover:bg-panel"
            >
              取消
            </Link>
            <button
              type="submit"
              disabled={pending}
              className="co-focusable cursor-pointer rounded-md bg-brand px-4 py-2 text-[14px] font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-subtle"
            >
              {pending ? "保存中…" : "保存修改"}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="确认删除这个问题？"
        description="删除后普通用户将无法看到该问题及其回答、评论；该操作会记录操作者与时间。"
        confirmLabel="确认删除"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => void handleDelete()}
      />
    </form>
  );
}
