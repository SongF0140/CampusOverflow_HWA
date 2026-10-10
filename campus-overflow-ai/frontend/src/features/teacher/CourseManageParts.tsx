"use client";

// 课程管理详情四 Tab 的内容组件（页面控件级设计说明 §3.3）：
// 问题/成员为独立分页请求（page_size=10）；标签直接消费头卡详情的 aggregates.tags，不另发请求
import { useEffect, useState } from "react";
import Link from "next/link";

import { listCourseMembers, listCourseQuestions } from "@/api/courses";
import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  LoadingSkeleton,
  Pagination,
  TagChip,
  UserLine,
  type ToastTone,
} from "@/shared/components";
import { toErrorMessage } from "@/shared/hooks/useAsyncData";
import type { CourseDetail, CourseMember } from "@/shared/types/course";
import type { QuestionListItem } from "@/shared/types/question";
import type { TagListItem } from "@/shared/types/tag";

// 全局操作反馈回调：由 CourseManageView 注入，统一在页顶渲染 Toast
export type ShowToast = (tone: ToastTone, message: string) => void;

const PAGE_SIZE = 10;

type ListStatus = "loading" | "ready" | "error";

// 问题 Tab：课程内问题分页列表，行内展示问题卡要点 + 隐藏内容处置入口（只跳工单处理页）
export function QuestionsTab({ courseId }: { courseId: number }) {
  const [page, setPage] = useState(1);
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
        const result = await listCourseQuestions(courseId, { page, page_size: PAGE_SIZE });
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
  }, [courseId, page, reloadToken]);

  return (
    <div className="flex flex-col gap-3">
      {status === "loading" ? <LoadingSkeleton variant="list" count={4} /> : null}

      {status === "error" ? (
        <ErrorState
          message={error ?? "课程问题加载失败，请稍后重试"}
          onRetry={() => setReloadToken((token) => token + 1)}
        />
      ) : null}

      {status === "ready" && items.length === 0 ? (
        <EmptyState title="该课程暂无问题" description="同学还没有在该课程下提问。" />
      ) : null}

      {status === "ready" && items.length > 0 ? (
        <>
          <ul className="flex flex-col gap-3">
            {items.map((question) => (
              <QuestionManageRow key={question.id} question={question} />
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
    </div>
  );
}

// 问题管理行：标题/作者/回答数要点 + 行内 [隐藏内容] 入口（跳 /teacher/moderation 处置）
function QuestionManageRow({ question }: { question: QuestionListItem }) {
  return (
    <li className="flex min-h-[64px] items-center justify-between gap-4 rounded-lg border border-line bg-canvas px-5 py-3">
      <div className="min-w-0">
        <Link
          href={`/questions/${question.id}`}
          className="co-focusable text-[15px] font-medium text-ink underline-offset-2 transition-colors duration-150 ease-standard hover:text-brand hover:underline"
        >
          {question.title}
        </Link>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[12px] text-ink-subtle">
          <span>提问者 · {question.author}</span>
          <span>{question.answer_count} 回答</span>
        </p>
      </div>
      <Link
        href="/teacher/moderation"
        className="co-focusable shrink-0 rounded-md border border-line bg-canvas px-3 py-1.5 text-[13px] font-medium text-ink transition-colors duration-150 ease-standard hover:bg-panel"
      >
        隐藏内容
      </Link>
    </li>
  );
}

// 成员 Tab：成员分页表格（用户/角色/加入时间/移出）
export function MembersTab({ courseId, showToast }: { courseId: number; showToast: ShowToast }) {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<CourseMember[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<ListStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setStatus("loading");
      try {
        const result = await listCourseMembers(courseId, { page, page_size: PAGE_SIZE });
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
  }, [courseId, page, reloadToken]);

  // TODO(接口差异)：后端仅提供 DELETE /courses/{id}/members/me（学生自退），
  // 无教师移出成员接口 → 点击仅 Toast 兜底，不渲染假确认流程
  function handleRemoveMember() {
    showToast("error", "移出成员接口尚未开放");
  }

  return (
    <div className="flex flex-col gap-3">
      {status === "loading" ? <LoadingSkeleton variant="list" count={4} /> : null}

      {status === "error" ? (
        <ErrorState
          message={error ?? "成员列表加载失败，请稍后重试"}
          onRetry={() => setReloadToken((token) => token + 1)}
        />
      ) : null}

      {status === "ready" && items.length === 0 ? (
        <EmptyState title="该课程暂无成员" description="还没有学生加入该课程。" />
      ) : null}

      {status === "ready" && items.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-line bg-canvas">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line text-[12px] text-ink-subtle">
                  <th scope="col" className="py-3 pl-5 pr-4 font-medium">用户</th>
                  <th scope="col" className="py-3 pr-4 font-medium">角色</th>
                  <th scope="col" className="py-3 pr-4 font-medium">加入时间</th>
                  <th scope="col" className="py-3 pr-4 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {/* 表行高度按控件设计 §0.2 取 64px 下限 */}
                {items.map((member) => (
                  <tr key={member.user_id} className="h-16 border-b border-line last:border-b-0">
                    <td className="py-3 pl-5 pr-4">
                      {/* 成员接口未回角色字段，按学生徽标展示（同课程活跃用户做法） */}
                      <UserLine
                        userId={member.user_id}
                        nickname={member.username}
                        role="student"
                        size="sm"
                      />
                    </td>
                    {/* TODO(接口差异)：CourseMember 仅含 user_id/username/joined_at → 角色列占位"成员" */}
                    <td className="py-3 pr-4 text-[13px] text-ink-muted">成员</td>
                    <td className="py-3 pr-4 text-[13px] text-ink-muted">
                      {formatJoinedDate(member.joined_at)}
                    </td>
                    <td className="py-3 pr-4">
                      <Button variant="ghost" onClick={handleRemoveMember}>
                        移出
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
    </div>
  );
}

// ISO 串直接截取日期部分展示，避免时区换算导致日期偏移
function formatJoinedDate(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : iso;
}

// 标签 Tab：本课程标签（来自详情聚合）+ 新建标签占位
export function TagsTab({ tags, showToast }: { tags: TagListItem[]; showToast: ShowToast }) {
  const [newTagName, setNewTagName] = useState("");

  // TODO(接口差异)：后端无 POST /api/tags（标签随问题发布绑定）→ 点击确认仅 Toast 兜底
  function handleCreateTag() {
    showToast("error", "新建标签接口尚未开放");
  }

  return (
    <div className="flex flex-col gap-4">
      {tags.length === 0 ? (
        <EmptyState title="该课程暂无标签" description="发布问题时选择的标签会展示在这里。" />
      ) : (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-line bg-canvas p-4">
          {tags.map((tag) => (
            <li key={tag.id} className="flex items-center gap-1.5">
              <TagChip label={tag.name} />
              <span className="text-[12px] text-ink-subtle">{tag.question_count} 个问题</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2 rounded-lg border border-line bg-canvas p-4">
        <h3 className="text-[14px] font-semibold text-ink">新建标签</h3>
        <div className="flex items-end gap-2">
          <Input
            label="标签名称"
            value={newTagName}
            maxLength={30}
            placeholder="如：动态规划"
            onChange={(event) => setNewTagName(event.target.value)}
          />
          <Button variant="ghost" onClick={handleCreateTag}>
            确认
          </Button>
        </div>
      </div>
    </div>
  );
}

// 设置 Tab：课程状态开关（禁用占位）+ 课程说明文案
export function SettingsTab({ detail }: { detail: CourseDetail }) {
  return (
    <section aria-label="课程设置" className="flex flex-col gap-5 rounded-lg border border-line bg-canvas p-5">
      <fieldset className="flex flex-col gap-2 border-none p-0">
        <legend className="text-[13px] font-medium text-ink-muted">课程状态</legend>
        <div className="flex items-center gap-5">
          <label className="flex items-center gap-2 text-[14px] text-ink">
            <input type="radio" name="course-status" value="active" disabled className="accent-brand" />
            进行中
          </label>
          <label className="flex items-center gap-2 text-[14px] text-ink">
            <input type="radio" name="course-status" value="closed" disabled className="accent-brand" />
            已结课
          </label>
        </div>
        {/* TODO(接口差异)：CourseDetailResponse 无 status 字段 → 开关禁用占位，后端补字段后联动 */}
        <p className="text-[12px] text-ink-subtle">后端暂未提供课程状态字段</p>
      </fieldset>
      <div className="flex flex-col gap-1 border-t border-line pt-4">
        <span className="text-[13px] font-medium text-ink-muted">课程说明</span>
        {detail.description ? (
          <p className="text-[14px] leading-relaxed text-ink">{detail.description}</p>
        ) : (
          <p className="text-[13px] text-ink-subtle">暂无课程简介</p>
        )}
      </div>
    </section>
  );
}
