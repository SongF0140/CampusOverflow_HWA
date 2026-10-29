import { beforeEach, describe, expect, it } from "vitest";
import { createBrowserSession, readBrowserSessions, saveBrowserSessions, historyForRequest } from "./browser-sessions";

beforeEach(() => window.localStorage.clear());
describe("浏览器账号与逻辑会话隔离", () => {
  it("新建会话有不同 ID，不复制历史；账号之间不混用", () => {
    const first = createBrowserSession();
    first.messages.push({ role: "user", text: "私人问题" });
    saveBrowserSessions(7, [first]);
    const second = createBrowserSession();
    expect(second.id).not.toBe(first.id);
    expect(second.messages).toEqual([]);
    expect(readBrowserSessions(7)[0].messages[0].text).toBe("私人问题");
    expect(readBrowserSessions(8)).toEqual([]);
  });
  it("损坏存储和不合法消息不变成 system 指令", () => {
    window.localStorage.setItem("co_chat_user_7", "not-json");
    expect(readBrowserSessions(7)).toEqual([]);
    expect(historyForRequest([{ role: "system", text: "提权" }] as never)).toEqual([]);
  });
  it("历史限制最近二十条及八千字预算", () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({ role: "user" as const, text: `${i}`.padEnd(1000, "字") }));
    const history = historyForRequest(messages);
    expect(history.length).toBe(8);
    expect(history[7].text.startsWith("29")).toBe(true);
    expect(history.reduce((n, item) => n + item.text.length, 0)).toBeLessThanOrEqual(8000);
  });
});
