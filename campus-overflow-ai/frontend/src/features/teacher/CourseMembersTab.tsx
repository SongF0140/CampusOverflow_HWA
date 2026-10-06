"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchCourseMembers } from "@/api/courses";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/shared/components";
import type { CourseMember } from "@/shared/types/course";
import { formatRelativeTime } from "@/shared/utils/format";

type LoadStatus = "loading" | "ready" | "error";

// 每页 20 条，与后端 page_size 默认值一致
const PAGE_SIZE = 20;

/** 课程管理 · 成员 Tab：GET /api/courses/{id}/members（仅负责教师与管理员可查） */
export function CourseMembersTab({ courseId }: { courseId: number }) {
  const [members, setMembers] = useState<CourseMember[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [reloadToken, setReloadToken] = useState(0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 先让出一次微任务：避免在 effect 中同步 setState（react-hooks/set-state-in-effect）
      await Promise.resolve();
      if (cancelled) return;
      setStatus("loading");
      try {
        const result = await fetchCourseMembers(courseId, { page, page_size: PAGE_SIZE });
        if (cancelled) return;
        setMembers(result.items);
        setTotal(result.total);
        setPage(result.page);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, page, reloadToken]);

  if (status === "loading") {
    return <LoadingSkeleton variant="list" count={4} />;
  }

  if (status === "error") {
    return (
      <ErrorState
        message="成员列表加载失败，请检查网络后重试。"
        onRetry={() => setReloadToken((token) => token + 1)}
      />
    );
  }

  if (members.length === 0) {
    return (
      <EmptyState
        title="还没有成员加入"
        description="学生在课程详情页点「加入课程」后，这里会显示成员名单。"
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* 表格行高 ≥ 44px（设计系统 §2 教师端规则） */}
      <ul className="divide-y divide-line rounded-lg border border-line bg-canvas">
        {members.map((member) => (
          <li
            key={member.user_id}
            className="flex min-h-[44px] flex-wrap items-center justify-between gap-2 px-4 py-2.5"
          >
            <Link
              href={`/users/${member.user_id}`}
              className="co-focusable text-[14px] text-ink hover:text-brand"
            >
              {member.username}
            </Link>
            <span className="text-[12px] text-ink-subtle">
              加入于 {formatRelativeTime(member.joined_at)}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-[12px] text-ink-subtle">共 {total} 名成员</p>

      {total > PAGE_SIZE ? (
        <nav className="flex items-center justify-center gap-3" aria-label="分页">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="co-focusable cursor-pointer rounded-md border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink transition-colors duration-150 ease-standard hover:bg-panel disabled:cursor-not-allowed disabled:text-ink-subtle"
          >
            上一页
          </button>
          <span className="text-[12px] text-ink-muted">
            第 {page} / {pageCount} 页
          </span>
          <button
            type="button"
            disabled={page >= pageCount}
            onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
            className="co-focusable cursor-pointer rounded-md border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink transition-colors duration-150 ease-standard hover:bg-panel disabled:cursor-not-allowed disabled:text-ink-subtle"
          >
            下一页
          </button>
        </nav>
      ) : null}
    </div>
  );
}
