"use client";

import { useRef, useState } from "react";

import { Button, MarkdownView, TabNav, Textarea } from "@/shared/components";

const MODE_TABS = [
  { key: "edit", label: "编辑" },
  { key: "preview", label: "预览" },
];

// 回答编辑器（§2.7 富文本精简版）：Textarea 6 行 + 轻量工具条 + 编辑/预览 Tab
// 写回答与内联编辑回答共用；提交结果由父级反馈（true 成功后父级负责关闭/重拉）
export function AnswerEditor({
  initialBody = "",
  submitLabel = "发布回答",
  placeholder = "写下你的回答，支持 Markdown 语法…",
  onSubmit,
  onCancel,
}: {
  initialBody?: string;
  submitLabel?: string;
  placeholder?: string;
  onSubmit: (body: string) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [body, setBody] = useState(initialBody);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 在光标选区两侧包裹 Markdown 标记；无选区时插入占位文本
  function wrapSelection(prefix: string, suffix: string = prefix) {
    const element = textareaRef.current;
    if (element === null) return;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const selected = body.slice(start, end) || "文本";
    setBody(`${body.slice(0, start)}${prefix}${selected}${suffix}${body.slice(end)}`);
  }

  async function handleSubmit() {
    const trimmed = body.trim();
    if (trimmed === "" || isSubmitting) return;
    setIsSubmitting(true);
    const ok = await onSubmit(trimmed);
    setIsSubmitting(false);
    if (ok) setMode("edit");
  }

  return (
    <form
      aria-label="回答编辑器"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSubmit();
      }}
      className="flex flex-col gap-3 rounded-lg border border-line bg-canvas p-4"
    >
      <TabNav
        tabs={MODE_TABS}
        active={mode}
        onChange={(key) => setMode(key === "preview" ? "preview" : "edit")}
        className="border-none"
      />

      {mode === "edit" ? (
        <>
          <div role="toolbar" aria-label="格式工具条" className="flex items-center gap-1">
            <Button variant="ghost" size="sm" aria-label="加粗" onClick={() => wrapSelection("**")}>
              B
            </Button>
            <Button variant="ghost" size="sm" aria-label="斜体" onClick={() => wrapSelection("*")}>
              I
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label="代码块"
              onClick={() => wrapSelection("\n```\n", "\n```\n")}
            >
              {"</>"}
            </Button>
          </div>
          <Textarea
            ref={textareaRef}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            rows={6}
            placeholder={placeholder}
            aria-label="回答正文"
          />
        </>
      ) : (
        <div
          aria-label="回答预览"
          className="min-h-[144px] rounded-md border border-line bg-panel p-3"
        >
          {body.trim() === "" ? (
            <p className="text-[13px] text-ink-subtle">暂无内容可预览</p>
          ) : (
            <MarkdownView content={body} />
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        {onCancel ? <Button variant="ghost" onClick={onCancel}>取消</Button> : null}
        <Button type="submit" isLoading={isSubmitting} disabled={body.trim() === ""}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
