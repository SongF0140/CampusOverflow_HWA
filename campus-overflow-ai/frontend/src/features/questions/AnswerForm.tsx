"use client";

import { useState, type FormEvent } from "react";

import { ApiError } from "@/api/client";

export function AnswerForm({ onSubmit }: { onSubmit: (body: string) => Promise<void> }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) {
      setError("回答内容不能为空");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onSubmit(body.trim());
      setBody("");
    } catch (caught) {
      // E-01 空内容 400 / E-07 封禁 403 / 500：都保留用户已填内容
      setError(caught instanceof ApiError ? caught.message : "提交失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-line bg-canvas p-5">
      <label className="flex flex-col gap-1.5">
        <span className="text-[14px] font-semibold text-ink">写回答</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={5}
          placeholder="支持 Markdown，尽量把思路写清楚"
          className="co-focusable w-full resize-y rounded-md border border-line bg-canvas px-3 py-2 text-[14px] leading-relaxed text-ink transition-colors duration-150 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
      </label>

      {error ? (
        <p role="alert" className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger-ink">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="co-focusable cursor-pointer rounded-md bg-brand px-4 py-2 text-[14px] font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-subtle"
        >
          {pending ? "发布中…" : "发布回答"}
        </button>
      </div>
    </form>
  );
}
