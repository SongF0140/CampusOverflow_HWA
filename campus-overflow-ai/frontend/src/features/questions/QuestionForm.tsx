"use client";

// 问题表单（页面控件级设计说明 §2.6，编辑页 §2.8 复用）：
// 标题 5~100 字失焦校验 + 计数；正文 Markdown 编辑（工具条 + 编辑/预览，1s 停顿缓存预览）；
// 课程必选 Select；标签手动搜索添加 ≤5；提交失败 400 走 Toast、500/网络错误保留内容并写草稿；
// 草稿 30s 定时 + beforeunload 兜底，进入时询问恢复
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { listCourses } from "@/api/courses";
import { ApiError } from "@/api/client";
import { useAsyncData } from "@/shared/hooks/useAsyncData";
import {
  Button,
  ErrorState,
  Input,
  MarkdownView,
  Select,
  TabNav,
  Textarea,
  Toast,
} from "@/shared/components";
import type { SelectOption } from "@/shared/components/Select";

import { TagPicker, type PickedTag } from "./TagPicker";
import {
  clearDraft,
  draftToPickedTags,
  loadDraft,
  saveDraft,
  shouldRestore,
  type QuestionDraft,
  type QuestionDraftValues,
} from "./draft";
import { timeAgo } from "./timeAgo";

// 可复用初始值：编辑页（C5）从问题详情映射 { title, content, course_id, tags }
export interface QuestionFormInitialValues {
  title?: string;
  content?: string;
  course_id?: number | null;
  tags?: PickedTag[];
}

// 提交给宿主的数据（蛇形，对齐 QuestionCreateInput）
export interface QuestionFormSubmitValues {
  title: string;
  body: string;
  course_id: number;
  tag_ids: Array<number | string>;
}

export interface QuestionFormProps<T = unknown> {
  initialValues?: QuestionFormInitialValues;
  // 传入即启用草稿自动保存/恢复（发布页固定 co_draft_new_question；编辑页可传独立 key）
  draftKey?: string;
  submitLabel?: string;
  pendingLabel?: string;
  successToast?: string;
  onSubmit: (values: QuestionFormSubmitValues) => Promise<T>;
  // 成功后回调（发布页跳详情、编辑页回详情）；Toast 由表单展示
  onSuccess?: (result: T) => void;
  onCancel?: () => void;
}

const TITLE_MAX = 100;
const TITLE_MIN = 5;
const COURSE_OPTION_LIMIT = 100;
const PREVIEW_DEBOUNCE_MS = 1000;
const DRAFT_SAVE_INTERVAL_MS = 30_000;
const TOAST_DURATION_MS = 3000;
const SERVER_ERROR_MESSAGE = "服务开小差了，请稍后重试";

// 标题校验（失焦与提交共用）：空 → 过短 → 超长
export function validateTitle(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return "请输入标题";
  if (trimmed.length < TITLE_MIN) return "标题至少 5 个字符";
  if (trimmed.length > TITLE_MAX) return "标题最多 100 个字符";
  return null;
}

// 轻量工具条：向选区插入 Markdown 语法（B/I/代码/链接）
const TOOLBAR_ACTIONS = [
  { key: "bold", glyph: "B", name: "加粗", prefix: "**", suffix: "**", placeholder: "加粗文本" },
  { key: "italic", glyph: "I", name: "斜体", prefix: "*", suffix: "*", placeholder: "斜体文本" },
  { key: "code", glyph: "</>", name: "代码", prefix: "`", suffix: "`", placeholder: "代码" },
  { key: "link", glyph: "🔗", name: "链接", prefix: "[", suffix: "](https://)", placeholder: "链接文本" },
] as const;

type EditorMode = "edit" | "preview";

export function QuestionForm<T = unknown>({
  initialValues,
  draftKey,
  submitLabel = "提交问题",
  pendingLabel = "发布中…",
  successToast = "发布成功",
  onSubmit,
  onSuccess,
  onCancel,
}: QuestionFormProps<T>) {
  const router = useRouter();
  const coursesState = useAsyncData(
    () => listCourses({ page: 1, page_size: COURSE_OPTION_LIMIT }),
    [],
  );

  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [content, setContent] = useState(initialValues?.content ?? "");
  const [courseId, setCourseId] = useState(
    initialValues?.course_id != null ? String(initialValues.course_id) : "",
  );
  const [tags, setTags] = useState<PickedTag[]>(initialValues?.tags ?? []);

  const [titleError, setTitleError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [courseError, setCourseError] = useState<string | null>(null);

  const [mode, setMode] = useState<EditorMode>("edit");
  const [previewContent, setPreviewContent] = useState(initialValues?.content ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [hasServerError, setHasServerError] = useState(false);
  const [draftBanner, setDraftBanner] = useState<QuestionDraft | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const initialValuesRef = useRef(initialValues);
  // 最新表单快照：草稿定时器/beforeunload 读取用（避免每次编辑重建 interval）
  const draftValuesRef = useRef<QuestionDraftValues>({
    title: initialValues?.title ?? "",
    content: initialValues?.content ?? "",
    course_id: initialValues?.course_id ?? null,
    tag_ids: (initialValues?.tags ?? []).map((tag) => tag.id ?? tag.name),
    tag_names: (initialValues?.tags ?? []).map((tag) => tag.name),
  });

  useEffect(() => {
    draftValuesRef.current = {
      title,
      content,
      course_id: courseId === "" ? null : Number(courseId),
      tag_ids: tags.map((tag) => tag.id ?? tag.name),
      tag_names: tags.map((tag) => tag.name),
    };
  });

  // 输入停顿 1s 后同步预览缓存（预览态展示最近一次停顿的快照）
  useEffect(() => {
    const timer = window.setTimeout(() => setPreviewContent(content), PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [content]);

  // Toast 自动消退
  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // 进入页面一次性询问草稿恢复：有草稿且表单为空才提示（§2.6）
  // 依赖 draftKey（挂载期不变）；StrictMode 重复挂载时第二次 effect 覆盖第一次
  useEffect(() => {
    if (!draftKey) return;
    let active = true;
    // 先让出同步执行栈再 setState（同 useAsyncData：避免 effect 内级联渲染）
    void Promise.resolve().then(() => {
      if (!active) return;
      const draft = loadDraft(draftKey);
      const initial = initialValuesRef.current;
      if (
        shouldRestore(draft, { title: initial?.title ?? "", content: initial?.content ?? "" })
      ) {
        setDraftBanner(draft);
      }
    });
    return () => {
      active = false;
    };
  }, [draftKey]);

  // 草稿自动保存：30s 定时 + beforeunload 兜底
  useEffect(() => {
    if (!draftKey) return;
    const save = (): void => {
      saveDraft(draftKey, draftValuesRef.current);
    };
    const timer = window.setInterval(save, DRAFT_SAVE_INTERVAL_MS);
    const handleBeforeUnload = (): void => save();
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [draftKey]);

  function handleTitleBlur(): void {
    setTitleError(validateTitle(title));
  }

  function insertMarkdown(prefix: string, suffix: string, placeholder: string): void {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? content.length;
    const end = el?.selectionEnd ?? start;
    const selected = content.slice(start, end) || placeholder;
    setContent(content.slice(0, start) + prefix + selected + suffix + content.slice(end));
    if (el) {
      // 等 React 提交新 value 后恢复焦点与选区（纯体验优化，失败无副作用）
      window.setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
      }, 0);
    }
  }

  function handleRestoreDraft(): void {
    if (draftBanner === null) return;
    const draft = draftBanner;
    setTitle(draft.title);
    setContent(draft.content);
    setPreviewContent(draft.content);
    setCourseId(draft.course_id !== null ? String(draft.course_id) : "");
    setTags(draftToPickedTags(draft));
    setTitleError(null);
    setContentError(null);
    setCourseError(null);
    setDraftBanner(null);
  }

  function handleDiscardDraft(): void {
    if (draftKey) clearDraft(draftKey);
    setDraftBanner(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const nextTitleError = validateTitle(title);
    const nextContentError = content.trim() === "" ? "请输入正文" : null;
    const nextCourseError = courseId === "" ? "请选择课程" : null;
    setTitleError(nextTitleError);
    setContentError(nextContentError);
    setCourseError(nextCourseError);
    if (nextTitleError !== null || nextContentError !== null || nextCourseError !== null) return;

    setIsSubmitting(true);
    setHasServerError(false);
    setToast(null);
    try {
      const result = await onSubmit({
        title: title.trim(),
        body: content,
        course_id: Number(courseId),
        tag_ids: tags.map((tag) => tag.id ?? tag.name),
      });
      if (draftKey) clearDraft(draftKey); // 提交成功清除草稿
      setToast({ tone: "success", message: successToast });
      onSuccess?.(result);
    } catch (caught) {
      // 失败兜底：当前内容写入草稿（500/网络错误表单不重置，刷新也能找回）
      if (draftKey) saveDraft(draftKey, draftValuesRef.current);
      if (caught instanceof ApiError && caught.code < 500) {
        // 400 等业务错误：透传后端中文 message
        setToast({ tone: "error", message: caught.message });
      } else {
        setHasServerError(true);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  const courseOptions: SelectOption[] = [
    { value: "", label: "请选择课程" },
    ...(coursesState.data?.items ?? []).map((course) => ({
      value: String(course.id),
      label: course.name,
    })),
  ];

  const isTitleOver = title.length > TITLE_MAX;

  return (
    <div className="flex flex-col gap-4">
      {draftBanner ? (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-brand-line bg-brand-soft px-4 py-2.5 text-[13px] text-ink"
        >
          <span>检测到未提交的草稿（保存于 {timeAgo(draftBanner.updatedAt)}）</span>
          <span className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={handleDiscardDraft}>
              丢弃
            </Button>
            <Button size="sm" onClick={handleRestoreDraft}>
              恢复
            </Button>
          </span>
        </div>
      ) : null}

      {toast ? (
        <Toast tone={toast.tone} message={toast.message} onClose={() => setToast(null)} />
      ) : null}

      {hasServerError ? <ErrorState message={SERVER_ERROR_MESSAGE} /> : null}

      <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
        <div>
          <Input
            label="标题"
            name="title"
            value={title}
            placeholder="一句话说清你的问题，例如：红黑树删除为什么要分四种情况？"
            error={titleError ?? undefined}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={handleTitleBlur}
          />
          <p
            className={`mt-1 text-right text-[12px] ${isTitleOver ? "text-danger-ink" : "text-ink-subtle"}`}
            aria-live="polite"
          >
            {title.length}/{TITLE_MAX}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-muted" id="question-body-label">
            正文
          </span>
          {mode === "edit" ? (
            <div className="flex gap-1" role="toolbar" aria-label="Markdown 工具条">
              {TOOLBAR_ACTIONS.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  aria-label={`插入${action.name}`}
                  title={`插入${action.name}`}
                  onClick={() => insertMarkdown(action.prefix, action.suffix, action.placeholder)}
                  className="co-focusable h-8 min-w-8 cursor-pointer rounded-md border border-line bg-canvas px-2 text-[12px] font-medium text-ink-muted transition-colors duration-150 ease-standard hover:bg-panel hover:text-ink"
                >
                  {action.glyph}
                </button>
              ))}
            </div>
          ) : null}
          {mode === "edit" ? (
            <Textarea
              ref={textareaRef}
              aria-label="正文"
              rows={6}
              value={content}
              placeholder="用 Markdown 描述问题背景、已尝试的做法与报错信息…"
              error={contentError ?? undefined}
              onChange={(event) => setContent(event.target.value)}
            />
          ) : (
            <div
              data-testid="preview-pane"
              aria-labelledby="question-body-label"
              className="min-h-[152px] rounded-md border border-line bg-canvas px-3 py-2"
            >
              {previewContent.trim() === "" ? (
                <p className="text-[13px] text-ink-subtle">暂无内容可预览</p>
              ) : (
                <MarkdownView content={previewContent} />
              )}
            </div>
          )}
          <TabNav
            tabs={[
              { key: "edit", label: "编辑" },
              { key: "preview", label: "预览" },
            ]}
            active={mode}
            onChange={(key) => setMode(key === "preview" ? "preview" : "edit")}
          />
        </div>

        <Select
          label="课程"
          value={courseId}
          options={courseOptions}
          hint="问题将发布到所选课程的问答区"
          error={courseError ?? undefined}
          onChange={(event) => setCourseId(event.target.value)}
        />

        <TagPicker value={tags} onChange={setTags} maxCount={5} />

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={onCancel ?? (() => router.back())}
            disabled={isSubmitting}
          >
            取消
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            {isSubmitting ? pendingLabel : submitLabel}
          </Button>
        </div>
      </form>
    </div>
  );
}
