"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { ApiError } from "@/api/client";
import { fetchCourseDetail } from "@/api/courses";
import { createQuestion } from "@/api/questions";
import { fetchTags } from "@/api/tags";
import { CourseSelect } from "@/features/courses/CourseSelect";
import { TagChip } from "@/shared/components";
import { QUESTION_MAX_TAGS, TITLE_MAX_LEN, USER_ROLE } from "@/shared/constants/domain";
import { useSessionStore } from "@/shared/stores/session-store";
import type { TagListItem } from "@/shared/types/tag";

const inputClass =
  "co-focusable w-full rounded-md border border-line bg-canvas px-3 py-2 text-[14px] text-ink transition-colors duration-150 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20";

export function PublishForm({ initialCourseId }: { initialCourseId?: number }) {
  const router = useRouter();
  const role = useSessionStore((state) => state.user?.role);
  const [tags, setTags] = useState<TagListItem[]>([]);
  const [courseId, setCourseId] = useState<number | "">(initialCourseId ?? "");
  const [courseCheck, setCourseCheck] = useState<{ id: number; joined: boolean | null } | null>(
    null,
  );
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const tagList = await fetchTags();
        if (cancelled) return;
        setTags(tagList.items);
      } catch {
        if (!cancelled) setTags([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * 课程列表接口没有 joined 字段（后端缺口已登记），选中课程后单独查一次加入状态。
   * 学生未加入时后端一定拒绝发布（"未加入该课程，不能在课程内发布问题"），提前提示并挡住必然失败的提交。
   * 后端只豁免该课程的负责教师（管理员不豁免），所以前端只对学生做预检，最终权限一律以后端为准。
   * joined 为 null 表示查不到加入状态（接口失败）：不拦提交，交给后端判定。
   */
  useEffect(() => {
    if (!courseId) return;
    let cancelled = false;
    const id = Number(courseId);
    void fetchCourseDetail(Number(courseId))
      .then((detail) => {
        if (!cancelled) setCourseCheck({ id, joined: detail.joined });
      })
      .catch(() => {
        if (!cancelled) setCourseCheck({ id, joined: null });
      });
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const checked = courseCheck?.id === Number(courseId);
  const needJoin = role === USER_ROLE.student && checked && courseCheck.joined === false;
  // 预检（角色 + 课程加入状态）确认前先不放开提交，避免极快操作撞到后端 403
  const submitBlocked = pending || needJoin || role === undefined || (Boolean(courseId) && !checked);

  function toggleTag(tagId: number) {
    setSelectedTagIds((prev) => {
      if (prev.includes(tagId)) return prev.filter((id) => id !== tagId);
      if (prev.length >= QUESTION_MAX_TAGS) return prev;
      return [...prev, tagId];
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!courseId) {
      setError("请选择课程");
      return;
    }
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
      const { data, message } = await createQuestion({
        title: title.trim(),
        body: body.trim(),
        course_id: Number(courseId),
        tag_ids: selectedTagIds.length > 0 ? selectedTagIds : null,
      });
      // 成功一律跳转详情页；只有后端提示里带「截断」时才把它作为 notice 带到详情页。
      // 这样既不靠文案决定"跳不跳转"，也不会把普通成功文案当成提示展示。
      // TODO(建议后端在 data 里返回 truncated 布尔字段)：届时改为读字段，不做文案判断。
      const hasTruncationNotice = message.includes("截断");
      router.replace(
        hasTruncationNotice
          ? `/questions/${data.id}?notice=${encodeURIComponent(message)}`
          : `/questions/${data.id}`,
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "发布失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-5 rounded-lg border border-line bg-canvas p-6">
        <h1 className="text-[22px] font-semibold text-ink">发布问题</h1>

        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">课程（需已加入）</span>
          <CourseSelect
            label="课程（需已加入）"
            value={courseId === "" ? undefined : courseId}
            onChange={(id) => setCourseId(id ?? "")}
          />
        </div>

        {needJoin ? (
          <p className="rounded-md border border-warning-soft bg-warning-soft px-3 py-2 text-[13px] text-warning-ink">
            你还没加入这门课程，加入后才能在这门课程下提问。
            <Link
              href={`/courses/${courseId}`}
              className="co-focusable ml-1 font-medium underline"
            >
              去加入课程
            </Link>
          </p>
        ) : null}

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
            placeholder="一句话说清你的问题"
            className={`${inputClass} h-11`}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">问题描述</span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={8}
            placeholder="支持 Markdown；写清背景、你已经试过什么、卡在哪"
            className={`${inputClass} resize-y leading-relaxed`}
          />
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium text-ink">
            标签
            <span className="ml-2 text-[12px] text-ink-subtle">
              最多 {QUESTION_MAX_TAGS} 个（已选 {selectedTagIds.length}）
            </span>
          </span>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <TagChip
                key={tag.id}
                label={tag.name}
                selected={selectedTagIds.includes(tag.id)}
                onClick={() => toggleTag(tag.id)}
              />
            ))}
            {tags.length === 0 ? <span className="text-[12px] text-ink-subtle">暂无可选标签</span> : null}
          </div>
        </div>

        {error ? (
          <p role="alert" className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger-ink">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-3">
          <Link
            href="/"
            className="co-focusable rounded-md border border-line bg-canvas px-4 py-2 text-[14px] font-medium text-ink transition-colors duration-150 ease-standard hover:bg-panel"
          >
            取消
          </Link>
          <button
            type="submit"
            disabled={submitBlocked}
            className="co-focusable cursor-pointer rounded-md bg-brand px-4 py-2 text-[14px] font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-subtle"
          >
            {pending ? "发布中…" : "发布问题"}
          </button>
        </div>
      </div>

      {/* AI 建议属第二阶段（T-13）；按文档「Agent 不可用时提示暂不可用、主流程不受影响」处理 */}
      <section
        aria-label="AI 建议"
        className="rounded-lg border border-dashed border-brand-line bg-brand-soft p-4"
      >
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-brand-strong">
          <span className="inline-block h-3 w-3 rounded-sm border border-brand" aria-hidden="true" />
          AI 辅助参考
        </h2>
        <p className="mt-2 text-[13px] text-ink-muted">
          相似问题推荐与标签推荐将在第二阶段接入；当前不影响你正常提问。
        </p>
      </section>
    </form>
  );
}
