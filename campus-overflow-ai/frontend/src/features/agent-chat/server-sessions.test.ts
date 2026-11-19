import { afterEach, expect, it, vi } from "vitest";
import { useSessionStore } from "@/shared/stores/session-store";
import { createServerContextStore } from "./server-sessions";
import type { UserMe } from "@/shared/types/auth";

const admin = { id: 1, role: "admin" } as UserMe;
afterEach(() => { vi.unstubAllGlobals(); useSessionStore.setState({ me: null }); });
it("管理员从服务端读取，不读或上传旧浏览器数据", async () => {
  useSessionStore.setState({ me: admin });
  window.localStorage.setItem("co_memory_user_1", "私人旧数据");
  const http = vi.fn(async () => new Response(JSON.stringify({ code: 200, data: { version: 0, entries: [] } })));
  vi.stubGlobal("fetch", http);
  expect(await createServerContextStore(1).memory()).toEqual({ version: 0, entries: [] });
  expect(http).toHaveBeenCalledTimes(1);
  expect(window.localStorage.getItem("co_memory_user_1")).toBe("私人旧数据");
});
it("账号切换后旧响应拒绝回写", async () => {
  useSessionStore.setState({ me: admin });
  let complete!: (value: Response) => void;
  vi.stubGlobal("fetch", () => new Promise<Response>(resolve => { complete = resolve; }));
  const pending = createServerContextStore(1).memory();
  useSessionStore.setState({ me: { ...admin, id: 2 } });
  complete(new Response(JSON.stringify({ code: 200, data: { version: 1, entries: [] } })));
  await expect(pending).rejects.toThrow("账号已切换");
});
it("教师和学生不能误入管理员适配器", async () => {
  useSessionStore.setState({ me: { ...admin, role: "teacher" } });
  const http = vi.fn(); vi.stubGlobal("fetch", http);
  await expect(createServerContextStore(1).memory()).rejects.toThrow();
  expect(http).not.toHaveBeenCalled();
});
