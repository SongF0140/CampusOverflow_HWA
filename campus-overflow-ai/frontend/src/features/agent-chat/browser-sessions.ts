export interface SessionMessage { role: "user" | "assistant"; text: string }
export interface BrowserSession { id: string; title: string; messages: SessionMessage[] }
const key = (userId: number) => `co_chat_user_${userId}`;
const isMessage = (value: unknown): value is SessionMessage => {
  if (!value || typeof value !== "object") return false;
  const item = value as SessionMessage;
  return (item.role === "user" || item.role === "assistant") && typeof item.text === "string";
};
export const createBrowserSession = (): BrowserSession => ({ id: crypto.randomUUID(), title: "新会话", messages: [] });
export const historyForRequest = (messages: SessionMessage[]): SessionMessage[] => {
  let budget = 8000;
  const result: SessionMessage[] = [];
  for (const entry of messages.filter(isMessage).slice(-20).reverse()) {
    if (budget <= 0) break;
    const text = entry.text.slice(0, Math.min(2000, budget));
    if (!text.trim()) continue;
    result.unshift({ role: entry.role, text });
    budget -= text.length;
  }
  return result;
};
export const readBrowserSessions = (userId: number): BrowserSession[] => {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(key(userId)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is BrowserSession => value && typeof value === "object"
      && typeof value.id === "string" && /^[0-9a-f-]{36}$/i.test(value.id)
      && typeof value.title === "string" && Array.isArray(value.messages))
      .slice(0, 20).map(value => ({ id: value.id, title: value.title.slice(0, 36),
        messages: value.messages.filter(isMessage).slice(-100).map(entry => ({ role: entry.role, text: entry.text.slice(0, 20_000) })) }));
  } catch { return []; }
};
export const saveBrowserSessions = (userId: number, sessions: BrowserSession[]): void => {
  window.localStorage.setItem(key(userId), JSON.stringify(sessions.slice(0, 20)));
};
