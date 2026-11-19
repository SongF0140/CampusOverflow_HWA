import { apiFetch } from "@/api/client";
import { useSessionStore } from "@/shared/stores/session-store";
import type { MemoryEntry } from "@/shared/lib/browser-memory";
import type { BrowserSession } from "./browser-sessions";

export interface ServerSession extends BrowserSession { version: number }
export interface ServerMemory { version: number; entries: MemoryEntry[] }
const BASE = "/governance/private-context";

/** 每次请求前后检查账号；旧账号请求不能更新新账号界面或继续发送排队写入。 */
export const createServerContextStore = (ownerId: number, signal?: AbortSignal) => {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const current = () => {
      const me = useSessionStore.getState().me;
      if (signal?.aborted || me?.id !== ownerId || me.role !== "admin") throw new DOMException("账号已切换", "AbortError");
    };
    current();
    const data = await apiFetch<T>(`${BASE}${path}`, { ...init, signal });
    current();
    return data;
  };
  return {
    memory: () => request<ServerMemory>("/memory"),
    writeMemory: (document: ServerMemory) => request<ServerMemory>("/memory", { method: "PUT", body: JSON.stringify(document) }),
    sessions: () => request<ServerSession[]>("/sessions"),
    createSession: (session: Pick<BrowserSession, "title" | "messages">, importKey?: string) => request<ServerSession>("/sessions", {
      method: "POST", body: JSON.stringify({ ...session, ...(importKey ? { import_key: importKey } : {}) }),
    }),
    session: (id: string) => request<ServerSession>(`/sessions/${encodeURIComponent(id)}`),
    saveSession: (session: ServerSession) => request<ServerSession>(`/sessions/${encodeURIComponent(session.id)}`, {
      method: "PUT", body: JSON.stringify({ version: session.version, title: session.title, messages: session.messages }),
    }),
    deleteSession: (session: ServerSession) => request(`/sessions/${encodeURIComponent(session.id)}`, {
      method: "DELETE", headers: { "If-Match": String(session.version) },
    }),
  };
};
