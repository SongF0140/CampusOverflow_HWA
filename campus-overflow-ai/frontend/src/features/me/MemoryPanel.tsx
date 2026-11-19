"use client";

// 个人记忆卡（T-14 M-01，AG-R04/Q-10）：当前登录账号的浏览器记忆
// 列表 / 新增 / 单条删除 / 全部清空（二次确认）。敏感内容写入被拦截（X-06）。
import { useState } from "react";

import {
  clearMemoryEntries,
  addMemoryEntry,
  removeMemoryEntry,
  listMemoryEntries,
} from "@/shared/lib/browser-memory";
import { Button, ConfirmDialog } from "@/shared/components";
import { useSessionStore } from "@/shared/stores/session-store";
import type { MemoryEntry } from "@/shared/lib/browser-memory";
import { ServerMemoryPanel } from "./ServerMemoryPanel";

export function MemoryPanel() {
  const me = useSessionStore(state => state.me);
  return me?.role === "admin" ? <ServerMemoryPanel key={me.id} ownerId={me.id} /> : <BrowserMemoryPanel key={me?.id} />;
}

function BrowserMemoryPanel() {
  const me = useSessionStore((state) => state.me);
  const [entries, setEntries] = useState<MemoryEntry[] | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const userId = me?.id;
  // 首次渲染按当前账号加载命名空间；账号切换（me.id 变化）重新加载
  const loadedFor = entries === null ? null : userId;
  if (userId !== undefined && loadedFor !== userId) {
    setEntries(listMemoryEntries(userId));
  }

  if (userId === undefined) {
    return null; // 未登录不渲染（/me 页本身有守卫，此处兜底）
  }

  function handleAdd() {
    if (userId === undefined) return;
    const result = addMemoryEntry(userId, draft);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setError(null);
    setDraft("");
    setEntries(result.entries);
  }

  function handleRemove(entryId: string) {
    if (userId === undefined) return;
    setEntries(removeMemoryEntry(userId, entryId));
  }

  function handleClearAll() {
    if (userId === undefined) return;
    clearMemoryEntries(userId);
    setEntries([]);
    setConfirmingClear(false);
  }

  return (
    <section id="memory" className="rounded-lg border border-line bg-canvas p-4" aria-label="个人记忆">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-semibold text-ink">个人记忆</h3>
        {entries !== null && entries.length > 0 ? (
          <Button variant="ghost" onClick={() => setConfirmingClear(true)}>
            全部清空
          </Button>
        ) : null}
      </div>
      <p className="mt-1 text-[12px] text-ink-subtle">
        仅保存在本浏览器中、按账号隔离，AI 对话时作为偏好参考；不云同步，他人不可见。
      </p>

      {entries !== null && entries.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2 text-[13px]">
              <span className="min-w-0 flex-1 text-ink">{entry.content}</span>
              <button
                type="button"
                className="shrink-0 text-[12px] text-red-500 hover:underline"
                onClick={() => handleRemove(entry.id)}
              >
                删除
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[13px] text-ink-subtle">
          暂无记忆。可保存学习偏好或课程上下文，AI 建议会参考它们。
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value.slice(0, 500));
            setError(null);
          }}
          placeholder="新增记忆（如：我偏好简洁的回答）"
          className="flex-1 rounded border border-line px-3 py-2 text-[13px]"
          aria-label="新增记忆内容"
        />
        <Button variant="ghost" onClick={() => handleAdd()} disabled={!draft.trim()}>
          添加
        </Button>
      </div>
      {error !== null ? (
        <p className="mt-1 text-[12px] text-red-600" role="alert">{error}</p>
      ) : null}

      {confirmingClear ? (
        <ConfirmDialog
          open
          danger
          title="清空全部个人记忆"
          description="清空后这些记忆不再参与 AI 请求与建议，且无法恢复。仅影响当前账号在本浏览器的记忆。"
          confirmLabel="确认清空"
          onConfirm={() => handleClearAll()}
          onCancel={() => setConfirmingClear(false)}
        />
      ) : null}
    </section>
  );
}
