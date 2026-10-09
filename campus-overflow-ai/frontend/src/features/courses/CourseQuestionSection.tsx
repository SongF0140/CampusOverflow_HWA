"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { listCourseQuestions } from "@/api/courses";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Pagination,
  TabNav,
  TagChip,
} from "@/shared/components";
import { toErrorMessage } from "@/shared/hooks/useAsyncData";
import { useSessionStore } from "@/shared/stores/session-store";
import type { QuestionListItem, QuestionListParams, QuestionSort } from "@/shared/types/question";
import type { TagListItem } from "@/shared/types/tag";
import { currentPath, redirectToLogin } from "@/shared/utils/navigation";

import { QuestionCard } from "@/features/questions/QuestionCard";

type ListStatus = "loading" | "ready" | "error";

const PAGE_SIZE = 10;

const SORT_TABS = [
  { key: "latest", label: "最新" },
  { key: "hot", label: "热门" },
];

// 课程问答区（页面控件级设计说明 §2.5）：我要提问 + 最新/热门 Tab + 常用标签行 + 问题卡分页列表
// sort/page 写入 URL searchParams（replaceState），刷新后由服务端解析回填 initial 值
export function CourseQuestionSection({
  courseId,
  tags,
  initialSort,
  initialPage,
}: {
  courseId: number;
  tags: TagListItem[];
  initialSort: QuestionSort;
  initialPage: number;
}) {
  const router = useRouter();
  const me = useSessionStore((state) => state.me);
  const sessionStatus = useSessionStore((state) => state.status);

  const [sort, setSort] = useState<QuestionSort>(initialSort);
  const [page, setPage] = useState(initialPage);
  const [items, setItems] = useState<QuestionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<ListStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 先让出一次微任务：避免在 effect 中同步 setState（react-hooks/set-state-in-effect）
      await Promise.resolve();
      if (cancelled) return;
      setStatus("loading");
      try {
        const result = await listCourseQuestions(courseId, {
          sort,
          page,
          page_size: PAGE_SIZE,
        } satisfies QuestionListParams);
        if (cancelled) return;
        setItems(result.items);
        setTotal(result.total);
        setStatus("ready");
      } catch (caught) {
        if (cancelled) return;
        setError(toErrorMessage(caught));
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, sort, page, reloadToken]);

  // 筛选/翻页写 URL（sort=latest 与 page=1 为默认值不写入），便于分享与刷新回填
  useEffect(() => {
    const params = new URLSearchParams();
    if (sort === "hot") params.set("sort", "hot");
    if (page > 1) params.set("page", String(page));
    const query = params.toString();
    window.history.replaceState(null, "", `/courses/${courseId}${query ? `?${query}` : ""}`);
  }, [courseId, sort, page]);

  function handleSortChange(key: string) {
    const next = key === "hot" ? "hot" : "latest";
    setSort(next);
    setPage(1);
  }

  function handleAsk() {
    // 游客引导登录；会话探测中不响应，避免误跳登录页
    if (sessionStatus === "guest") {
      redirectToLogin(currentPath());
      return;
    }
    if (sessionStatus !== "authed") return;
    router.push(`/questions/new?course_id=${courseId}`);
  }

  return (
    <section id="course-qa" aria-label="课程问答区" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[18px] font-semibold text-ink">问答区</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={handleAsk}
            disabled={sessionStatus === "loading"}
            aria-label="我要提问"
          >
            ＋ 我要提问
          </Button>
          <TabNav
            tabs={SORT_TABS}
            active={sort}
            onChange={handleSortChange}
            className="border-none"
          />
        </div>
      </div>

      {tags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] text-ink-subtle">本课程常用标签</span>
          {tags.map((tag) => (
            <TagChip
              key={tag.id}
              label={tag.name}
              onClick={() => router.push(`/tags/${tag.id}`)}
            />
          ))}
        </div>
      ) : null}

      {status === "loading" ? <LoadingSkeleton variant="list" count={4} /> : null}

      {status === "error" ? (
        <ErrorState
          message={error ?? "课程问题加载失败，请稍后重试"}
          onRetry={() => setReloadToken((token) => token + 1)}
        />
      ) : null}

      {status === "ready" && items.length === 0 ? (
        <EmptyState
          title="本课程还没有问题"
          description={
            me
              ? "来提第一个问题，同学和老师会看到并解答。"
              : "登录后即可在课程内提问。"
          }
          actionLabel={me ? "提第一个问题" : undefined}
          onAction={me ? handleAsk : undefined}
        />
      ) : null}

      {status === "ready" && items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-3">
            {items.map((question) => (
              <li key={question.id}>
                <QuestionCard question={question} />
              </li>
            ))}
          </ul>
          {total > PAGE_SIZE ? (
            <div className="flex justify-center">
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={total}
                onChange={(next) => setPage(next)}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
