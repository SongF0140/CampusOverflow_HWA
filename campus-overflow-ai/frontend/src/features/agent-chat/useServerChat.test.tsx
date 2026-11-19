import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSessionStore } from "@/shared/stores/session-store";
import type { UserMe } from "@/shared/types/auth";
import { useServerChat } from "./useServerChat";
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/api/agent-chat", () => ({ sendAgentChat: mocks.send }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useSessionStore.setState({ me: null }); mocks.send.mockReset(); });

it("管理员刷新恢复服务器历史，清空后迟到流不能恢复内容", async () => {
  useSessionStore.setState({ me: { id: 1, role: "admin" } as UserMe });
  const id = crypto.randomUUID();
  let stored = { id, version: 1, title: "服务器会话", messages: [{ role: "user", text: "已有问题" }] };
  const writes: unknown[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    let data;
    if (init?.method === "PUT") { stored = { ...stored, ...JSON.parse(String(init.body)), version: stored.version + 1 }; writes.push(stored); data = stored; }
    else data = url.endsWith("/sessions") ? [stored] : stored;
    return Response.json({ code: 200, data });
  });
  let emit!: (text: string) => void;
  let finish!: (value: { finishReason: string }) => void;
  mocks.send.mockImplementation((_message, handlers) => { emit = handlers.onDelta; return new Promise(resolve => { finish = resolve; }); });
  const { result } = renderHook(() => useServerChat(1));
  await waitFor(() => expect(result.current.active.title).toBe("服务器会话"));
  let pending!: Promise<void>;
  act(() => { pending = result.current.send("新问题"); });
  await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
  await act(async () => { await result.current.clearSession(); });
  await act(async () => { emit("迟到回答"); finish({ finishReason: "stop" }); await pending; });
  expect(result.current.active.messages).toEqual([]);
  expect(stored.messages).toEqual([]);
  expect(writes).toHaveLength(2);
  expect(window.localStorage.getItem("co_chat_user_1")).toBeNull();
});
