"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { ApiError } from "@/api/client";
import { fetchCourses } from "@/api/courses";
import { createQuestion } from "@/api/questions";
import { fetchTags } from "@/api/tags";
import { LoadingSkeleton, TagChip } from "@/shared/components";
import type { CourseListItem } from "@/shared/types/course";
import type { TagListItem } from "@/shared/types/tag";

// 与后端 qa/domain 的上限保持一致（超出由后端截断并在 message 里提示，E-02）
const TITLE_MAX_LEN = 100;
const MAX_TAGS = 5;

const inputClass =
  "co-focusable w-full rounded-md border border-line bg-canvas px-3 py-2 text-[14px] text-ink transition-colors duration-150 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20";

export function PublishForm({ initialCourseId }: { initialCourseId?: number }) {
  const router = useRouter();
  const [courses, setCourses] = useState<CourseListItem[] | null>(null);
  const [tags, setTags] = useState<TagListItem[]>([]);
  const [courseId, setCourseId] = useState<number | "">(initialCourseId ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<{ id: number; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [courseList, tagList] = await Promise.all([fetchCourses(), fetchTags()]);
        if (cancelled) return;
        setCourses(courseList.items);
        setTags(tagList.items);
      } catch {
        if (!cancelled) setCourses([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggleTag(tagId: number) {
    setSelectedTagIds((prev) => {
      if (prev.includes(tagId)) return prev.filter((id) => id !== tagId);
      if (prev.length >= MAX_TAGS) return prev; // 与后端 QUESTION_MAX_TAGS 一致
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
      // 后端把「内容超长已截断」提示放在 message 里（E-02）：有额外提示时留在本页告知
      if (message === "发布成功") {
        router.replace(`/questions/${data.id}`);
      } else {
        setCreated({ id: data.id, message });
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "发布失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  if (created) {
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-success/40 bg-success-soft p-6">
        <p className="text-[15px] font-semibold text-success-ink">发布成功</p>
        <p className="text-[13px] text-success-ink">{created.message}</p>
        <div className="flex gap-3">
          <Link
            href={`/questions/${created.id}`}
            className="co-focusable rounded-md bg-brand px-4 py-2 text-[14px] font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-strong"
          >
            查看问题
          </Link>
          <Link
            href="/"
            className="co-focusable rounded-md border border-line bg-canvas px-4 py-2 text-[14px] font-medium text-ink transition-colors duration-150 ease-standard hover:bg-panel"
          >
            回问题广场
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-5 rounded-lg border border-line bg-canvas p-6">
        <h1 className="text-[22px] font-semibold text-ink">发布问题</h1>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">课程（需已加入）</span>
          {courses === null ? (
            <LoadingSkeleton variant="list" count={1} />
          ) : (
            <select
              value={courseId}
              onChange={(event) => setCourseId(event.target.value ? Number(event.target.value) : "")}
              className={`${inputClass} h-11 cursor-pointer`}
            >
              <option value="">请选择课程</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.name}（{course.code}）
                </option>
              ))}
            </select>
          )}
        </label>

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
              最多 {MAX_TAGS} 个（已选 {selectedTagIds.length}）
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
            disabled={pending}
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
