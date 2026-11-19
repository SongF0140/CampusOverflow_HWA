"use client";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type RefObject } from "react";
import { sendAgentChat } from "@/api/agent-chat";
import { MEMORY_CHANGED_EVENT } from "@/shared/lib/browser-memory";
import { createServerContextStore, type ServerSession } from "./server-sessions";
import type { SessionMessage } from "./browser-sessions";

interface LoadState {
  setSessions: Dispatch<SetStateAction<ServerSession[]>>;
  setActiveId: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setSending: Dispatch<SetStateAction<boolean>>;
  generation: RefObject<number>;
  controller: RefObject<AbortController | null>;
}
function useServerSessionLoad(ownerId: number, state: LoadState) {
  const { setSessions, setActiveId, setError, setSending, generation, controller } = state;
  const initialKey = useRef(crypto.randomUUID());
  useEffect(() => {
    const abort = new AbortController();
    const invalidate = () => { generation.current++; controller.current?.abort(); };
    const store = createServerContextStore(ownerId, abort.signal);
    void (async () => {
      const stored = await store.sessions();
      const items = stored.length ? stored : [await store.createSession({ title: "新会话", messages: [] }, initialKey.current)];
      if (!abort.signal.aborted) { setSessions(items); setActiveId(items[0].id); }
    })().catch(() => { if (!abort.signal.aborted) setError("服务器会话暂不可用，请刷新后重试"); });
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ userId: number }>).detail?.userId === ownerId) { invalidate(); setSending(false); }
    };
    window.addEventListener(MEMORY_CHANGED_EVENT, changed);
    return () => { abort.abort(); invalidate(); window.removeEventListener(MEMORY_CHANGED_EVENT, changed); };
  }, [ownerId, setSessions, setActiveId, setError, setSending, generation, controller]);
}

export function useServerChat(ownerId: number) {
  const [sessions, setSessions] = useState<ServerSession[]>([]);
  const [activeId, setActiveId] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const active = sessions.find(item => item.id === activeId) ?? sessions[0] ?? { id: "", title: "加载中", messages: [], version: 0 };
  const cancel = () => { generation.current++; controller.current?.abort(); controller.current = null; setSending(false); };
  const replace = (saved: ServerSession) => setSessions(previous => previous.map(item => item.id === saved.id ? saved : item));
  useServerSessionLoad(ownerId, { setSessions, setActiveId, setError, setSending, generation, controller });
  const selectSession = (id: string) => { cancel(); setActiveId(id); setError(null); };
  const newSession = async () => {
    cancel(); const at = generation.current;
    try {
      const saved = await createServerContextStore(ownerId).createSession({ title: "新会话", messages: [] });
      if (generation.current === at) { setSessions(previous => [saved, ...previous]); setActiveId(saved.id); setError(null); }
    } catch (caught) { if (generation.current === at) setError(caught instanceof Error ? caught.message : "创建失败"); }
  };
  const clearSession = async () => {
    if (!active.id) return;
    cancel(); const at = generation.current;
    try {
      const store = createServerContextStore(ownerId);
      const fresh = await store.session(active.id);
      const saved = await store.saveSession({ ...fresh, messages: [] });
      if (at === generation.current) { replace(saved); setError(null); }
    } catch (caught) { if (at === generation.current) setError(caught instanceof Error ? caught.message : "清空失败"); }
  };
  const send = async (message: string, learningContext?: { course_id?: number; trusted_tag_ids?: number[] }) => {
    if (!message.trim() || sending || !active.id) return;
    cancel(); const at = generation.current;
    const abort = new AbortController(); controller.current = abort;
    const current = () => at === generation.current && !abort.signal.aborted;
    const store = createServerContextStore(ownerId, abort.signal);
    let text = "";
    setSending(true); setError(null);
    try {
      const saved = await store.saveSession({ ...active, title: active.messages.length ? active.title : message.slice(0, 36),
        messages: [...active.messages, { role: "user" as const, text: message }].slice(-99) });
      if (!current()) return;
      replace({ ...saved, messages: [...saved.messages, { role: "assistant", text: "" }] });
      const result = await sendAgentChat(message, { onDelta: delta => {
        if (!current()) return;
        text = (text + delta).slice(0, 20_000);
        replace({ ...saved, messages: [...saved.messages, { role: "assistant", text }] });
      } }, { signal: abort.signal, sessionId: saved.id, history: active.messages, learningContext });
      if (!result.finishReason || !current()) return;
      const messages: SessionMessage[] = [...saved.messages, { role: "assistant", text }];
      const completed = await store.saveSession({ ...saved, messages });
      if (current()) replace(completed);
    } catch (caught) { if (current()) setError(caught instanceof Error ? caught.message : "聊天或保存失败，请核对服务器状态"); }
    finally { if (current()) { setSending(false); controller.current = null; } }
  };
  const deleteSession = async () => {
    cancel(); const at = generation.current;
    try {
      const store = createServerContextStore(ownerId);
      const fresh = await store.session(active.id);
      await store.deleteSession(fresh);
      const remaining = await store.sessions();
      const items = remaining.length ? remaining : [await store.createSession({ title: "新会话", messages: [] })];
      if (at === generation.current) { setSessions(items); setActiveId(items[0].id); }
    } catch (caught) { if (at === generation.current) setError(caught instanceof Error ? caught.message : "删除失败"); }
  };
  return { sessions, active, sending, error, send, newSession, selectSession, clearSession, deleteSession };
}
