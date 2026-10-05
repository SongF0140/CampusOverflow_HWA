// 问题表单草稿纯函数（页面控件级设计说明 §2.6 草稿自动保存 / §2.8 编辑页同款）：
// 只做 localStorage 读写、形状校验与恢复判断，不含 React，便于 vitest 单测
export const NEW_QUESTION_DRAFT_KEY = "co_draft_new_question";

// tag_ids 二态与后端一致：int = 已有标签 id；str = 新自定义标签名
export interface QuestionDraft {
  title: string;
  content: string;
  course_id: number | null;
  tag_ids: Array<number | string>;
  // 与 tag_ids 平行的展示名（恢复已选 chip 用；旧草稿缺省时数字 id 退化为占位文案）
  tag_names: string[] | null;
  updatedAt: string;
}

export interface QuestionDraftValues {
  title: string;
  content: string;
  course_id: number | null;
  tag_ids: Array<number | string>;
  tag_names?: string[] | null;
}

// 恢复判断所需的表单快照
export interface DraftRestoreCheck {
  title: string;
  content: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// 宽松归一：任何字段缺失/类型不对都降级为安全默认值，updatedAt 非法视为无草稿
function toDraft(raw: Record<string, unknown>): QuestionDraft | null {
  const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : "";
  if (updatedAt === "" || Number.isNaN(Date.parse(updatedAt))) return null;
  const tagIds = Array.isArray(raw.tag_ids)
    ? raw.tag_ids.filter(
        (entry): entry is number | string =>
          typeof entry === "number" || typeof entry === "string",
      )
    : [];
  const tagNames = Array.isArray(raw.tag_names)
    ? raw.tag_names.filter((entry): entry is string => typeof entry === "string")
    : null;
  return {
    title: typeof raw.title === "string" ? raw.title : "",
    content: typeof raw.content === "string" ? raw.content : "",
    course_id:
      typeof raw.course_id === "number" && Number.isInteger(raw.course_id)
        ? raw.course_id
        : null,
    tag_ids: tagIds,
    tag_names: tagNames,
    updatedAt,
  };
}

export function saveDraft(key: string, values: QuestionDraftValues): boolean {
  const draft: QuestionDraft = {
    title: values.title,
    content: values.content,
    course_id: values.course_id,
    tag_ids: values.tag_ids,
    tag_names: values.tag_names ?? null,
    updatedAt: new Date().toISOString(),
  };
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
    return true;
  } catch {
    // 存储被禁用/写满时降级：草稿是增强能力，不阻塞编辑主流程
    return false;
  }
}

export function loadDraft(key: string): QuestionDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    return toDraft(parsed);
  } catch {
    return null; // 损坏/不可读草稿一律视为无草稿
  }
}

export function clearDraft(key: string): boolean {
  try {
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

// 草稿是否值得恢复：草稿里确有内容（标题或正文非空）且当前表单为空
export function shouldRestore(
  draft: QuestionDraft | null,
  form: DraftRestoreCheck,
): boolean {
  if (draft === null) return false;
  const hasDraftContent = draft.title.trim() !== "" || draft.content.trim() !== "";
  const isFormEmpty = form.title.trim() === "" && form.content.trim() === "";
  return hasDraftContent && isFormEmpty;
}

// 草稿 → 已选标签（TagPicker.PickedTag 同构：id 缺省表示新标签名）
export function draftToPickedTags(
  draft: QuestionDraft,
): Array<{ id?: number; name: string }> {
  return draft.tag_ids.map((entry, index) => {
    if (typeof entry === "number") {
      return { id: entry, name: draft.tag_names?.[index] ?? `标签 ${entry}` };
    }
    return { name: entry };
  });
}
