"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ApiError } from "@/api/client";
import { fetchCourseDetail } from "@/api/courses";
import {
  acceptAnswer,
  certifyAnswer,
  createAnswer,
  fetchQuestionDetail,
  uncertifyAnswer,
  vote,
} from "@/api/questions";
import { EmptyState, ErrorState, LoadingSkeleton, Pagination, StatusBadge, TagChip } from "@/shared/components";
import { MarkdownBody } from "@/shared/components";
import { ANSWER_SORTS, QUESTION_STATUS, USER_ROLE } from "@/shared/constants/domain";
import { useSessionStore } from "@/shared/stores/session-store";
import type { AnswerSort, QuestionDetail } from "@/shared/types/question";
import { isAuthorOf } from "@/shared/utils/ownership";
import { previewVote } from "@/shared/utils/vote";
import { formatRelativeTime } from "@/shared/utils/format";

import { AnswerCard } from "./AnswerCard";
import { AnswerForm } from "./AnswerForm";
import { CommentList } from "./CommentList";
import { RelatedQuestions } from "./RelatedQuestions";
import { VoteControl } from "./VoteControl";
import { ANSWER_PAGE_SIZE, useAnswerPagination } from "./useAnswerPagination";

type LoadStatus = "loading" | "ready" | "error";

// 排序取值必须来自常量（对齐后端 Query pattern）；标签不叫「已采纳」以免与回答徽标撞词
const ANSWER_SORT_LABELS: Record<AnswerSort, string> = {
  latest: "最新",
  votes: "票数",
  accepted: "已采纳优先",
};

export function QuestionDetailView({
  questionId,
  notice,
  initialSort = "latest",
}: {
  questionId: number;
  notice?: string;
  /** 回答区初始排序：详情页 URL ?sort= 由服务端解析后回填 */
  initialSort?: AnswerSort;
}) {
  const currentUser = useSessionStore((state) => state.me);
  const loadSession = useSessionStore((state) => state.loadMe);

  const [detail, setDetail] = useState<QuestionDetail | null>(null);
  const [courseName, setCourseName] = useState<string | null>(null);
  const [courseOwnership, setCourseOwnership] = useState<{ courseId: number; userId?: number; isOwner: boolean } | null>(null);
  const [answerSort, setAnswerSort] = useState<AnswerSort>(initialSort);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [actionError, setActionError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(notice ?? null);
  const [reloadToken, setReloadToken] = useState(0);
  const answerPage = useAnswerPagination(
    questionId, answerSort, reloadToken, String(currentUser?.id ?? currentUser?.username ?? ""),
    status === "ready" && detail?.id === questionId,
  );
  const { answers, setAnswers } = answerPage;

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve(); // 避免在 effect 内同步 setState
      if (cancelled) return;
      setStatus("loading");
      try {
        const question = await fetchQuestionDetail(questionId);
        if (cancelled) return;
        setDetail(question);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [questionId, reloadToken]);

  // 课程详情只补认证资格，问题课程名称直接取正式字段。
  useEffect(() => {
    if (!detail) return;
    let cancelled = false;
    void (async () => {
      try {
        const course = await fetchCourseDetail(detail.course_id);
        if (cancelled) return;
        setCourseName(detail.course_name || course.name);
        setCourseOwnership({ courseId: detail.course_id, userId: currentUser?.id, isOwner: course.is_owner === true });
      } catch {
        if (!cancelled) {
          setCourseName(null);
          setCourseOwnership(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detail, currentUser?.id]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  // 乐观更新：先改本地，失败回滚并提示（设计系统 §5）
  async function handleQuestionVote(value: 1 | -1) {
    if (!detail) return;
    const snapshot = { score: detail.vote_score, myVote: detail.my_vote };
    const preview = previewVote(snapshot.score, snapshot.myVote, value);
    setDetail({ ...detail, vote_score: preview.score, my_vote: preview.myVote });
    setActionError(null);
    try {
      const result = await vote("question", detail.id, value);
      setDetail((current) =>
        current ? { ...current, vote_score: result.vote_score, my_vote: result.my_vote } : current,
      );
    } catch (caught) {
      setDetail((current) =>
        current ? { ...current, vote_score: snapshot.score, my_vote: snapshot.myVote } : current,
      );
      setActionError(caught instanceof ApiError ? caught.message : "投票失败，请稍后重试");
    }
  }

  async function handleAnswerVote(answerId: number, value: 1 | -1) {
    const target = answers.find((item) => item.id === answerId);
    if (!target) return;
    const snapshot = { score: target.vote_score, myVote: target.my_vote };
    const preview = previewVote(snapshot.score, snapshot.myVote, value);
    setAnswers((items) =>
      items.map((item) =>
        item.id === answerId
          ? { ...item, vote_score: preview.score, my_vote: preview.myVote }
          : item,
      ),
    );
    setActionError(null);
    try {
      const result = await vote("answer", answerId, value);
      setAnswers((items) =>
        items.map((item) =>
          item.id === answerId
            ? { ...item, vote_score: result.vote_score, my_vote: result.my_vote }
            : item,
        ),
      );
    } catch (caught) {
      setAnswers((items) =>
        items.map((item) =>
          item.id === answerId
            ? { ...item, vote_score: snapshot.score, my_vote: snapshot.myVote }
            : item,
        ),
      );
      setActionError(caught instanceof ApiError ? caught.message : "投票失败，请稍后重试");
    }
  }

  async function handleAccept(answerId: number) {
    setActionError(null);
    try {
      await acceptAnswer(answerId);
      setBanner("已采纳该回答，问题状态变为「已解决」");
      reload();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "采纳失败，请稍后重试");
    }
  }

  async function handleCreateAnswer(body: string) {
    await createAnswer(questionId, body);
    setBanner("回答已发布");
    reload();
  }

  async function handleCertify(answerId: number, certified: boolean) {
    setActionError(null);
    try {
      if (certified) {
        await certifyAnswer(answerId);
        setBanner("已认证为优质内容");
      } else {
        await uncertifyAnswer(answerId);
        setBanner("已取消优质内容认证");
      }
      reload();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "认证操作失败，请稍后重试");
    }
  }

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-4">
        <LoadingSkeleton variant="detail" count={2} />
        <LoadingSkeleton variant="list" count={2} />
      </div>
    );
  }

  if (status === "error" || !detail) {
    return <ErrorState message="问题加载失败，可能已被删除或网络异常。" onRetry={reload} />;
  }

  const isAsker = isAuthorOf(currentUser?.username, detail.author);
  const canCertify =
    currentUser?.role === USER_ROLE.teacher &&
    courseOwnership?.courseId === detail.course_id &&
    courseOwnership?.userId === currentUser.id && courseOwnership.isOwner;
  const resolved =
    detail.status === QUESTION_STATUS.resolved || detail.accepted_answer_id !== null;

  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="面包屑" className="flex items-center gap-2 text-[12px] text-ink-subtle">
        <Link href="/" className="co-focusable text-ink-muted hover:text-brand">
          问题广场
        </Link>
        <span aria-hidden="true">/</span>
        <span>{detail.course_name || courseName || `课程 ${detail.course_id}`}</span>
      </nav>

      {banner ? (
        <p className="flex items-center justify-between gap-3 rounded-md border border-success/40 bg-success-soft px-4 py-2.5 text-[13px] text-success-ink">
          <span>{banner}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="co-focusable cursor-pointer text-[12px] text-success-ink/80 hover:text-success-ink"
          >
            关闭
          </button>
        </p>
      ) : null}

      {actionError ? (
        <p role="alert" className="rounded-md border border-danger-line bg-danger-soft px-4 py-2.5 text-[13px] text-danger-ink">
          {actionError}
        </p>
      ) : null}

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <article className="rounded-lg border border-line bg-canvas p-6">
            <div className="flex items-start justify-between gap-4">
              <h1 className="text-[22px] font-semibold leading-snug text-ink">{detail.title}</h1>
              <StatusBadge
                tone={resolved ? "done" : "open"}
                label={resolved ? "已解决" : "未解决"}
              />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-subtle">
              <span className="text-ink-muted">{detail.author}</span>
              <span aria-hidden="true">·</span>
              <span>{formatRelativeTime(detail.created_at)}</span>
              <span aria-hidden="true">·</span>
              <span>{detail.view_count} 浏览</span>
              {isAsker ? (
                <>
                  <span aria-hidden="true">·</span>
                  <Link
                    href={`/questions/${detail.id}/edit`}
                    className="co-focusable text-ink-muted hover:text-brand"
                  >
                    编辑
                  </Link>
                </>
              ) : null}
            </div>

            {detail.tags.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {detail.tags.map((tag) => (
                  <TagChip key={tag.id} label={tag.name} />
                ))}
              </div>
            ) : null}

            <div className="mt-5 flex gap-4">
              <VoteControl
                score={detail.vote_score}
                myVote={detail.my_vote}
                label="问题票数"
                onVote={(value) => void handleQuestionVote(value)}
              />
              <div className="min-w-0 flex-1">
                <MarkdownBody content={detail.body} />
              </div>
            </div>
          </article>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[18px] font-semibold text-ink">
                {answerPage.status === "ready" ? `${answerPage.total} 个回答` : "回答"}
              </h2>
              <div className="flex items-center gap-1 rounded-md border border-line bg-canvas p-0.5">
                {ANSWER_SORTS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAnswerSort(value)}
                    aria-pressed={answerSort === value}
                    className={`co-focusable cursor-pointer rounded-sm px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 ease-standard ${
                      answerSort === value
                        ? "bg-brand-soft text-brand-strong"
                        : "text-ink-muted hover:bg-panel"
                    }`}
                  >
                    {ANSWER_SORT_LABELS[value]}
                  </button>
                ))}
              </div>
            </div>

            {answerPage.targetMissing ? (
              <p role="status" className="text-[13px] text-ink-muted">目标回答不存在或已删除，已显示第一页回答。</p>
            ) : null}
            {answerPage.status === "loading" ? (
              <LoadingSkeleton variant="list" count={2} />
            ) : answerPage.status === "error" ? (
              <ErrorState message="回答加载失败，请稍后重试。" onRetry={reload} />
            ) : answers.length === 0 ? (
              <EmptyState
                title="还没有人回答"
                description="把你的思路写下来，帮同学也帮自己。"
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {answers.map((answer) => (
                  <li key={answer.id}>
                    <AnswerCard
                      answer={answer}
                      canAccept={isAsker}
                      onAccept={(id) => void handleAccept(id)}
                      onVote={(id, value) => void handleAnswerVote(id, value)}
                      canCertify={canCertify}
                      onCertify={(id, certified) => void handleCertify(id, certified)}
                    />
                  </li>
                ))}
              </ul>
            )}

            {answerPage.status === "ready" && answerPage.total > ANSWER_PAGE_SIZE ? (
              <Pagination page={answerPage.page} pageSize={ANSWER_PAGE_SIZE} total={answerPage.total} onChange={answerPage.changePage} />
            ) : null}

            <AnswerForm onSubmit={handleCreateAnswer} />
          </section>

          <CommentList questionId={detail.id} currentUsername={currentUser?.username} />
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-[280px]">
          <section className="rounded-lg border border-line bg-canvas p-4">
            <h2 className="text-[14px] font-semibold text-ink">提问者</h2>
            <p className="mt-2 text-[13px] text-ink">{detail.author}</p>
            {/* TODO(下一批页面): /users/{id} 页面就绪后，这里改为可点击跳转用户主页 */}
            <p className="mt-1 text-[11px] text-ink-subtle">（用户主页将在下一批页面接入）</p>
          </section>
          <RelatedQuestions questionId={detail.id} />
        </aside>
      </div>
    </div>
  );
}

/** 无效问题 id / 内容缺失占位（详情页与编辑页的页面壳共用） */
export function QuestionMissing() {
  const router = useRouter();
  return (
    <EmptyState
      title="内容不存在或已删除"
      description="该问题可能已被作者删除，或链接有误。"
      actionLabel="返回问题广场"
      onAction={() => router.push("/")}
    />
  );
}
