"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ApiError } from "@/api/client";
import { fetchCourseDetail, joinCourse, leaveCourse } from "@/api/courses";
import { QuestionList } from "@/features/questions/QuestionList";
import { ConfirmDialog, ErrorState, LoadingSkeleton, TagChip } from "@/shared/components";
import { USER_ROLE } from "@/shared/constants/domain";
import { useSessionStore } from "@/shared/stores/session-store";
import type { CourseAggregates, CourseDetail } from "@/shared/types/course";
import type { QuestionSort } from "@/shared/types/question";

type LoadStatus = "loading" | "ready" | "error";

/** 四聚合区块用的折叠卡片 */
function AggBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-canvas p-4">
      <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function QuestionLinks({ items }: { items: CourseAggregates["hot_questions"] }) {
  if (items.length === 0) {
    return <p className="text-[12px] text-ink-subtle">暂无</p>;
  }

  return (
    <ol className="flex flex-col gap-2">
      {items.slice(0, 5).map((item) => (
        <li key={item.id}>
          <Link
            href={`/questions/${item.id}`}
            className="co-focusable line-clamp-2 text-[13px] text-ink hover:text-brand"
          >
            {item.title}
          </Link>
        </li>
      ))}
    </ol>
  );
}

/** 课程详情（P-S03）：四聚合区块 + 课程问答区 + 加入/退出课程 */
export function CourseDetailView({
  courseId,
  initialKeyword = "",
  initialSort = "latest",
  initialUnresolved = false,
}: {
  courseId: number;
  initialKeyword?: string;
  initialSort?: QuestionSort;
  initialUnresolved?: boolean;
}) {
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [reloadToken, setReloadToken] = useState(0);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const role = useSessionStore((state) => state.user?.role);
  const username = useSessionStore((state) => state.user?.username);
  const load = useSessionStore((state) => state.load);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 先让出一次微任务：避免在 effect 中同步 setState（react-hooks/set-state-in-effect）
      await Promise.resolve();
      if (cancelled) return;
      setStatus("loading");
      try {
        const result = await fetchCourseDetail(courseId);
        if (cancelled) return;
        setDetail(result);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, reloadToken]);

  async function handleJoin() {
    setPending(true);
    setActionError(null);
    try {
      await joinCourse(courseId);
      setDetail((current) => (current ? { ...current, joined: true } : current));
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "加入课程失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  async function handleLeave() {
    setConfirmLeave(false);
    setPending(true);
    setActionError(null);
    try {
      await leaveCourse(courseId);
      setDetail((current) => (current ? { ...current, joined: false } : current));
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : "退出课程失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  if (status === "loading") {
    return <LoadingSkeleton variant="detail" count={3} />;
  }

  if (status === "error" || !detail) {
    return (
      <ErrorState
        message="课程详情加载失败，请检查网络后重试。"
        onRetry={() => setReloadToken((token) => token + 1)}
      />
    );
  }

  const { aggregates } = detail;
  // 后端当前把 frequent_questions 与 hot_questions 返回同一份列表，避免页面出现两块重复内容
  const frequentDistinct =
    aggregates.frequent_questions.length > 0 &&
    aggregates.frequent_questions[0]?.id !== aggregates.hot_questions[0]?.id;
  // 加入/退出接口只允许学生角色（courses/router.py require_roles("student")），其他角色不渲染入口
  const canJoin = role === USER_ROLE.student;
  // 发布资格（后端 T-04）：课程负责教师 或 已加入成员。
  // 课程详情响应暂缺 can_post / is_owner（后端缺口已登记），先用「教师名 == 当前用户名」判定负责教师；
  // 不能只按 role === teacher 放行——非负责教师仍然无权发布。
  const isCourseOwner = role === USER_ROLE.teacher && detail.teacher_name === username;
  const canPost = detail.joined || isCourseOwner;

  return (
    <div className="flex flex-col gap-6">
      <nav className="text-[12px] text-ink-subtle" aria-label="面包屑">
        <Link href="/courses" className="co-focusable hover:text-brand">
          课程列表
        </Link>
        <span className="mx-1.5" aria-hidden="true">
          /
        </span>
        <span>{detail.name}</span>
      </nav>

      <section className="rounded-lg border border-line bg-canvas p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-[22px] font-semibold text-ink">{detail.name}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-subtle">
              <span className="text-ink-muted">{detail.code}</span>
              <span aria-hidden="true">·</span>
              <span>授课：{detail.teacher_name}</span>
              {detail.semester ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{detail.semester}</span>
                </>
              ) : null}
            </p>
            {detail.description ? (
              <p className="mt-3 max-w-[720px] text-[14px] leading-[1.75] text-ink-muted">
                {detail.description}
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {canPost ? (
              <Link
                href={`/questions/new?course_id=${courseId}`}
                className="co-focusable rounded-md bg-brand px-4 py-2 text-[13px] font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-strong"
              >
                我要提问
              </Link>
            ) : null}
            {canJoin && detail.joined ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => setConfirmLeave(true)}
                className="co-focusable cursor-pointer rounded-md border border-line px-4 py-2 text-[13px] font-medium text-ink transition-colors duration-150 ease-standard hover:bg-panel disabled:cursor-not-allowed disabled:text-ink-subtle"
              >
                退出课程
              </button>
            ) : null}
            {canJoin && !detail.joined ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => void handleJoin()}
                className="co-focusable cursor-pointer rounded-md bg-brand px-4 py-2 text-[13px] font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-subtle"
              >
                加入课程
              </button>
            ) : null}
          </div>
        </div>

        {actionError ? <p className="mt-3 text-[13px] text-danger-ink">{actionError}</p> : null}
        {!canPost ? (
          <p className="mt-3 text-[12px] text-ink-subtle">
            加入课程后可以在这门课程下提问。
          </p>
        ) : null}
      </section>

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1">
          <QuestionList
            courseId={courseId}
            initialKeyword={initialKeyword}
            initialSort={initialSort}
            initialUnresolved={initialUnresolved}
            title="课程问答"
            headingLevel="h2"
            basePath={`/courses/${courseId}`}
          />
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-[320px]">
          <AggBlock title="热门问题">
            <QuestionLinks items={aggregates.hot_questions} />
          </AggBlock>

          {frequentDistinct ? (
            <AggBlock title="高频问题">
              <QuestionLinks items={aggregates.frequent_questions} />
            </AggBlock>
          ) : null}

          <AggBlock title="课程标签">
            {aggregates.tags.length === 0 ? (
              <p className="text-[12px] text-ink-subtle">暂无</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {aggregates.tags.slice(0, 8).map((tag) => (
                  <Link key={tag.id} href={`/tags/${tag.id}`} className="co-focusable">
                    <TagChip label={tag.name} />
                  </Link>
                ))}
              </div>
            )}
          </AggBlock>

          <AggBlock title="活跃用户">
            {aggregates.active_users.length === 0 ? (
              <p className="text-[12px] text-ink-subtle">暂无</p>
            ) : (
              <ol className="flex flex-col gap-2">
                {aggregates.active_users.slice(0, 5).map((member) => (
                  <li key={member.user_id} className="flex items-center justify-between gap-2">
                    <Link
                      href={`/users/${member.user_id}`}
                      className="co-focusable min-w-0 flex-1 truncate text-[13px] text-ink hover:text-brand"
                    >
                      {member.username}
                    </Link>
                    <span className="shrink-0 text-[12px] text-ink-subtle">
                      {member.activity_count} 次参与
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </AggBlock>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmLeave}
        title="确认退出这门课程？"
        description="退出后需要重新加入，才能在这门课程下提问。"
        confirmLabel="确认退出"
        danger
        onConfirm={() => void handleLeave()}
        onCancel={() => setConfirmLeave(false)}
      />
    </div>
  );
}
