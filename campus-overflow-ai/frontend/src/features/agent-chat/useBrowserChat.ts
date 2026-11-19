"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { AgentChatError, sendAgentChat } from "@/api/agent-chat";
import { MEMORY_CHANGED_EVENT, MEMORY_KEY_PREFIX } from "@/shared/lib/browser-memory";
import { createBrowserSession, readBrowserSessions, saveBrowserSessions, type BrowserSession, type SessionMessage } from "./browser-sessions";

function useChatCancellation(userId: number, setSending: Dispatch<SetStateAction<boolean>>) {
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const cancel = () => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setSending(false);
  };
  useEffect(() => {
    const stopOnMemoryChange = (event: Event) => {
      const changed = event as CustomEvent<{ userId: number }>;
      if (changed.detail?.userId === userId) {
        generationRef.current += 1;
        controllerRef.current?.abort();
        setSending(false);
      }
    };
    const stopOnStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === `${MEMORY_KEY_PREFIX}${userId}`) {
        generationRef.current += 1;
        controllerRef.current?.abort();
        setSending(false);
      }
    };
    window.addEventListener(MEMORY_CHANGED_EVENT, stopOnMemoryChange);
    window.addEventListener("storage", stopOnStorage);
    return () => {
      generationRef.current += 1;
      controllerRef.current?.abort();
      window.removeEventListener(MEMORY_CHANGED_EVENT, stopOnMemoryChange);
      window.removeEventListener("storage", stopOnStorage);
    };
  }, [userId, setSending]);
  return { controllerRef, generationRef, cancel };
}

function usePersistSessions(userId: number, sessions: BrowserSession[], setError: Dispatch<SetStateAction<string | null>>) {
  useEffect(() => {
    let mounted = true;
    try { saveBrowserSessions(userId, sessions); }
    catch {
      queueMicrotask(() => { if (mounted) setError("浏览器空间不足，本次会话暂未保存"); });
    }
    return () => { mounted = false; };
  }, [sessions, userId, setError]);
}

export function useBrowserChat(userId: number) {
  const [sessions, setSessions] = useState(() => {
    const stored = readBrowserSessions(userId);
    return stored.length ? stored : [createBrowserSession()];
  });
  const [activeId, setActiveId] = useState(sessions[0].id);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { controllerRef, generationRef, cancel } = useChatCancellation(userId, setSending);
  const active = sessions.find(item => item.id === activeId) ?? sessions[0];
  usePersistSessions(userId, sessions, setError);

  const updateMessages = (id: string, update: (messages: SessionMessage[]) => SessionMessage[]) => {
    setSessions(previous => previous.map(item => item.id === id ? { ...item, messages: update(item.messages).slice(-100) } : item));
  };
  const selectSession = (id: string) => { cancel(); setActiveId(id); setError(null); };
  const newSession = () => {
    cancel();
    const session = createBrowserSession();
    setSessions(previous => [session, ...previous].slice(0, 20));
    setActiveId(session.id);
    setError(null);
  };
  const clearSession = () => { cancel(); updateMessages(active.id, () => []); setError(null); };

  const send = async (message: string, learningContext?: { course_id?: number; trusted_tag_ids?: number[] }) => {
    if (!message.trim() || sending) return;
    cancel();
    const currentGeneration = generationRef.current;
    const abort = new AbortController();
    controllerRef.current = abort;
    const isCurrent = () => generationRef.current === currentGeneration && !abort.signal.aborted;
    setError(null);
    setSending(true);
    setSessions(previous => previous.map(item => item.id === active.id ? {
      ...item, title: item.messages.length ? item.title : message.slice(0, 36),
      messages: [...item.messages, { role: "user" as const, text: message }, { role: "assistant" as const, text: "" }].slice(-100),
    } : item));
    try {
      const result = await sendAgentChat(message, { onDelta: text => {
        if (!isCurrent()) return;
        updateMessages(active.id, previous => {
          const next = [...previous];
          const last = next[next.length - 1];
          if (last?.role === "assistant") next[next.length - 1] = { ...last, text: (last.text + text).slice(0, 20_000) };
          return next;
        });
      } }, { signal: abort.signal, sessionId: active.id, history: active.messages,
        learningContext: learningContext ? { ...learningContext,
          ...(learningContext.trusted_tag_ids?.length ? { learning_event_id: crypto.randomUUID() } : {}) } : undefined });
      if (!result.finishReason) throw new AgentChatError("回复异常结束，请重试");
    } catch (caught) {
      if (!isCurrent()) return;
      setError(caught instanceof AgentChatError ? caught.message : "AI 助手暂不可用，请稍后重试");
      updateMessages(active.id, previous => previous.at(-1)?.text === "" ? previous.slice(0, -1) : previous);
    } finally {
      if (isCurrent()) { setSending(false); controllerRef.current = null; }
    }
  };
  return { sessions, active, sending, error, send, newSession, selectSession, clearSession };
}
