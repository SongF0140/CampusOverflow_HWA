"use client";
import { useState } from "react";
import { Button, ConfirmDialog } from "@/shared/components";
import { readBrowserSessions } from "./browser-sessions";
import { createServerContextStore } from "./server-sessions";

export function ServerSessionImport({ ownerId }: { ownerId: number }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const legacy = readBrowserSessions(ownerId);
  if (!legacy.length) return null;
  const run = async () => {
    setBusy(true); setConfirm(false);
    try {
      const store = createServerContextStore(ownerId);
      for (const session of legacy) await store.createSession({ title: session.title, messages: session.messages }, session.id);
      setMessage("导入成功。刷新可查看服务器会话；旧浏览器副本尚未删除。");
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "导入未完成，重试会跳过已导入会话"); }
    finally { setBusy(false); }
  };
  return <aside className="space-y-2 rounded border border-line p-3 text-sm">
    <p>检测到 {legacy.length} 个旧浏览器会话，尚未自动上传。</p>
    <details><summary>查看待导入会话</summary>{legacy.map(session => <details key={session.id}><summary>{session.title}（{session.messages.length} 条消息）</summary>
      {session.messages.map((item, index) => <p key={index}>{item.role === "user" ? "我" : "助手"}：{item.text}</p>)}</details>)}</details>
    <Button disabled={busy} onClick={() => setConfirm(true)}>导入旧浏览器会话</Button>
    {message ? <p role="status">{message}</p> : null}
    {confirm ? <ConfirmDialog open title="导入旧浏览器会话" description="将上方会话上传到本账号服务器私人目录；重复导入不重复创建，不删除本地副本。"
      confirmLabel="确认导入" onConfirm={() => void run()} onCancel={() => setConfirm(false)} /> : null}
  </aside>;
}
