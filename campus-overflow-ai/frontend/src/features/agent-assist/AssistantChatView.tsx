"use client";

// AI 课程助手（T-14 端到端接线）：学生端最小聊天入口。
// 请求经 api/agent-chat 封装自动携带当前账号的个人记忆（浏览器隔离），
// 回复经 SSE 流式增量展示；AI 回答仅作建议参考（C-01 口径文案）。
import { useEffect, useMemo, useRef, useState } from "react";

import { sendAgentChat, AgentChatError } from "@/api/agent-chat";
import { Button } from "@/shared/components";
import { buildMemoryContext } from "@/shared/lib/browser-memory";
import { useSessionStore } from "@/shared/stores/session-store";

const MESSAGE_MAX = 2000;

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export function AssistantChatView() {
  const me = useSessionStore((state) => state.me);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  // 记忆可感知：进入页面时统计当前账号将携带的记忆条数（不展示内容）
  const memoryCount = useMemo(
    () => (me ? buildMemoryContext(me.id).length : 0),
    // 仅按账号计算一次；页面存续期间 /me 的增删不实时刷新（下次进入生效）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [me?.id],
  );

  // 新消息后滚动到底部
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  async function handleSend() {
    const message = draft.trim();
    if (!message || sending) return;
    setError(null);
    setDraft("");
    setMessages((previous) => [...previous, { role: "user", text: message }, { role: "assistant", text: "" }]);
    setSending(true);
    try {
      const result = await sendAgentChat(message, {
        onDelta: (text) => {
          setMessages((previous) => {
            const next = [...previous];
            const last = next[next.length - 1];
            if (last?.role === "assistant") next[next.length - 1] = { ...last, text: last.text + text };
            return next;
          });
        },
      });
      if (!result.finishReason) throw new AgentChatError("回复异常结束，请重试");
    } catch (caught) {
      const failure = caught instanceof AgentChatError
        ? caught.message
        : "AI 助手暂不可用，请稍后重试";
      setError(failure);
      // 空回复的占位移除，保留已发消息
      setMessages((previous) => {
        const next = [...previous];
        const last = next[next.length - 1];
        if (last?.role === "assistant" && last.text === "") next.pop();
        return next;
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4 px-4 py-6 sm:px-8">
      <div>
        <h1 className="text-[22px] font-semibold text-ink">AI 课程助手</h1>
        <p className="mt-1 text-[12px] text-ink-subtle">
          回答由 AI 生成、仅作学习参考；{memoryCount > 0
            ? `已携带你的 ${memoryCount} 条个人记忆（在个人中心管理，AI 只读）`
            : "在个人中心保存个人记忆后，回答会参考你的偏好"}
          。
        </p>
      </div>

      <ol
        ref={listRef}
        aria-label="对话记录"
        className="flex max-h-[52vh] min-h-[220px] flex-col gap-3 overflow-y-auto rounded-lg border border-line bg-canvas p-4"
      >
        {messages.length === 0 ? (
          <li className="text-[13px] text-ink-subtle">
            输入课程问题开始对话，例如：帮我梳理死锁的四个必要条件。
          </li>
        ) : messages.map((message, index) => (
          <li
            key={index}
            className={`max-w-[85%] whitespace-pre-wrap rounded-md px-3 py-2 text-[13px] ${
              message.role === "user"
                ? "self-end bg-brand/10 text-ink"
                : "self-start border border-line-subtle bg-panel text-ink"
            }`}
          >
            {message.text === "" && message.role === "assistant" && sending ? "正在输入…" : message.text}
          </li>
        ))}
      </ol>

      {error !== null ? (
        <p className="text-[13px] text-red-600" role="alert">{error}</p>
      ) : null}

      <div className="flex gap-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value.slice(0, MESSAGE_MAX))}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
          placeholder="输入课程问题（Enter 发送，Shift+Enter 换行）"
          rows={2}
          aria-label="消息输入"
          className="flex-1 resize-none rounded border border-line px-3 py-2 text-[13px]"
          disabled={sending}
        />
        <Button onClick={() => void handleSend()} disabled={!draft.trim() || sending}>
          {sending ? "回答中…" : "发送"}
        </Button>
      </div>
    </div>
  );
}
