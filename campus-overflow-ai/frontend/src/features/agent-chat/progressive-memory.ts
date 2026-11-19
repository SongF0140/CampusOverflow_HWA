import { listMemoryEntries } from "@/shared/lib/browser-memory";
import { useSessionStore } from "@/shared/stores/session-store";
import { createServerContextStore } from "./server-sessions";

export const prepareProgressiveMemory = async (
  ownerId: number, sessionId: string, message: string, signal: AbortSignal | undefined,
  assertCurrent: () => void,
): Promise<string[]> => {
  const entries = (useSessionStore.getState().me?.role === "admin"
    ? (await createServerContextStore(ownerId, signal).memory()).entries
    : listMemoryEntries(ownerId)).slice(0, 50);
  assertCurrent();
  if (entries.length === 0) return [];
  let selected = entries;
  for (const [stage, maxLength, limit] of [["index", 36, 5], ["summary", 100, 3], ["detail", 500, 3]] as const) {
    assertCurrent();
    if (selected.length === 0) return [];
    const response = await fetch("/api/agent/agent/sessions/memory/disclose", {
      method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", signal,
      body: JSON.stringify({ owner_id: ownerId, session_id: sessionId, message, stage,
        items: selected.map(entry => ({ id: entry.id, text: entry.content.slice(0, maxLength) })) }),
    });
    assertCurrent();
    const result: unknown = await response.json();
    if (!response.ok || !result || typeof result !== "object" || !("data" in result)) {
      throw new Error("记忆选择失败，请稍后重试");
    }
    const data = result.data as { session_id?: unknown; stage?: unknown; selected_ids?: unknown };
    if (!data || data.session_id !== sessionId || data.stage !== stage || !Array.isArray(data.selected_ids)
      || data.selected_ids.length > limit || new Set(data.selected_ids).size !== data.selected_ids.length
      || data.selected_ids.some(id => typeof id !== "string" || !selected.some(entry => entry.id === id))) {
      throw new Error("记忆选择结果不合法");
    }
    const ids = data.selected_ids;
    selected = selected.filter(entry => ids.includes(entry.id));
  }
  assertCurrent();
  return selected.map(entry => entry.content.slice(0, 500));
};
