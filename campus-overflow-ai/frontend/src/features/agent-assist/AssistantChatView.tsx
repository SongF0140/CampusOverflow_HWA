"use client";

// AI 课程助手（T-14 端到端接线）：学生端最小聊天入口。
// 请求经 api/agent-chat 封装自动携带当前账号的个人记忆（浏览器隔离），
// 回复经 SSE 流式增量展示；AI 回答仅作建议参考（C-01 口径文案）。
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Button, MarkdownView } from "@/shared/components";
import { listMemoryEntries } from "@/shared/lib/browser-memory";
import { useSessionStore } from "@/shared/stores/session-store";
import { useBrowserChat } from "@/features/agent-chat/useBrowserChat";
import { useServerChat } from "@/features/agent-chat/useServerChat";
import { ServerSessionImport } from "@/features/agent-chat/ServerSessionImport";
import { LearningContextPicker, type LearningContext } from "@/features/agent-chat/LearningContextPicker";

const MESSAGE_MAX = 2000;

const subscribeHydration = () => () => undefined;

export function AssistantChatView() {
  const me = useSessionStore((state) => state.me);
  const hydrated = useSyncExternalStore(subscribeHydration, () => true, () => false);
  if (!hydrated) return <p>正在读取本地会话…</p>;
  if (!me) return <p>登录后使用 AI 课程助手。</p>;
  return me.role === "admin" ? <ServerChatWindow key={me.id} userId={me.id} /> : <BrowserChatWindow key={me.id} userId={me.id} />;
}

function BrowserChatWindow({ userId }: { userId: number }) {
  return <ChatWindow userId={userId} flow={useBrowserChat(userId)} />;
}
function ServerChatWindow({ userId }: { userId: number }) {
  return <ChatWindow userId={userId} flow={useServerChat(userId)} />;
}
function ChatWindow({ userId, flow }: { userId: number; flow: ReturnType<typeof useBrowserChat> & { deleteSession?: () => Promise<void> } }) {
  const { sessions, active, sending, error, send, newSession, selectSession, clearSession } = flow;
  const messages = active.messages;
  const [draft, setDraft] = useState("");
  const [learningContext, setLearningContext] = useState<LearningContext>({});
  const role = useSessionStore(state => state.me?.role);
  const listRef = useRef<HTMLOListElement>(null);
  const memoryCount = role === "admin" ? 0 : listMemoryEntries(userId).length;

  // 新消息后滚动到底部
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  async function handleSend() {
    const message = draft.trim();
    if (!message || sending) return;
    setDraft("");
    await send(message, learningContext);
  }

  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4 px-4 py-6 sm:px-8">
      <div>
        <h1 className="text-[22px] font-semibold text-ink">{role === "admin" ? "治理助手" : role === "teacher" ? "教学助手" : "AI 课程助手"}</h1>
        <p className="mt-1 text-[12px] text-ink-subtle">
          回答由 AI 生成、仅作学习参考；{memoryCount > 0
            ? `已有你的 ${memoryCount} 条个人记忆，发送时按索引、摘要、详情逐层选择（在个人中心管理，AI 只读）`
            : "在个人中心保存个人记忆后，回答会参考你的偏好"}
          。
        </p>
      </div>

      <nav aria-label="会话列表" className="flex flex-wrap gap-2">
        <Button onClick={() => { newSession(); setDraft(""); setLearningContext({}); }}>＋ 新会话</Button>
        {sessions.map(session => <button key={session.id} type="button" aria-pressed={session.id === active.id}
          onClick={() => { selectSession(session.id); setDraft(""); setLearningContext({}); }}
          className="rounded border border-line px-3 py-2 text-sm text-ink">{session.title}</button>)}
        <button type="button" onClick={clearSession} className="rounded border border-line px-3 py-2 text-sm text-ink">清空当前会话</button>
      </nav>
      <p className="text-xs text-ink-subtle">{role === "admin" ? "会话与个人记忆保存在服务器私人目录，和中台会话隔离。" : "会话保存在此浏览器，按账号隔离；新会话不复制旧历史。"}</p>
      {flow.deleteSession ? <button type="button" disabled={sending || !active.id} onClick={() => {
        if (window.confirm("删除当前服务器会话？删除后不能恢复。")) void flow.deleteSession?.();
      }} className="text-left text-sm text-red-600">删除当前会话</button> : null}
      {role === "admin" ? <ServerSessionImport ownerId={userId} /> : null}
      <LearningContextPicker value={learningContext} onChange={setLearningContext} disabled={sending} canReport={role === "student"} />

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
            {message.text === "" && message.role === "assistant" && sending ? "正在输入…"
              : message.role === "assistant" ? <MarkdownView content={message.text} /> : message.text}
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
