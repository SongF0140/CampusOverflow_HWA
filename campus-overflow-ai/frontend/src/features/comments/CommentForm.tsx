"use client";

import { useState, type FormEvent } from "react";

import { Button, Input } from "@/shared/components";

// 评论输入行（§2.7）：Input + 发送；提交成功后清空，失败保留内容（错误 Toast 由父级统一提示）
export function CommentForm({ onSubmit }: { onSubmit: (body: string) => Promise<boolean> }) {
  const [body, setBody] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = body.trim();
    if (trimmed === "" || isSubmitting) return;
    setIsSubmitting(true);
    const ok = await onSubmit(trimmed);
    setIsSubmitting(false);
    if (ok) setBody("");
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="mt-3 flex items-center gap-2">
      <Input
        aria-label="评论内容"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="写下你的评论…"
        className="flex-1"
      />
      <Button type="submit" size="sm" isLoading={isSubmitting} disabled={body.trim() === ""}>
        发送
      </Button>
    </form>
  );
}
