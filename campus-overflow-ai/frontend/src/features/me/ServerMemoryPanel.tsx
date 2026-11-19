"use client";
import { useEffect, useState } from "react";
import { Button, ConfirmDialog } from "@/shared/components";
import { MEMORY_CHANGED_EVENT, listMemoryEntries, isSensitiveContent } from "@/shared/lib/browser-memory";
import { createServerContextStore, type ServerMemory } from "@/features/agent-chat/server-sessions";

export function ServerMemoryPanel({ ownerId }: { ownerId: number }) {
  const [document, setDocument] = useState<ServerMemory | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"clear" | "import" | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    createServerContextStore(ownerId, abort.signal).memory().then(setDocument).catch(() => {
      if (!abort.signal.aborted) setError("服务端记忆暂不可用，请刷新重试");
    });
    return () => abort.abort();
  }, [ownerId]);
  const update = async (entries: ServerMemory["entries"]) => {
    if (!document || busy) return;
    setBusy(true); setError(null);
    try {
      const saved = await createServerContextStore(ownerId).writeMemory({ version: document.version, entries });
      setDocument(saved); setDraft(""); setConfirm(null);
      window.dispatchEvent(new CustomEvent(MEMORY_CHANGED_EVENT, { detail: { userId: ownerId } }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败，请刷新后重试"); }
    finally { setBusy(false); }
  };
  const add = () => {
    const content = draft.trim();
    if (!content || content.length > 500 || isSensitiveContent(content)) { setError("内容为空、过长或包含敏感信息"); return; }
    if (document?.entries.some(entry => entry.content === content)) { setError("该记忆已存在"); return; }
    void update([...(document?.entries ?? []), { id: crypto.randomUUID(), content, created_at: new Date().toISOString() }]);
  };
  const legacy = listMemoryEntries(ownerId);
  const importLegacy = () => {
    const existing = document?.entries ?? [];
    void update([...existing, ...legacy.filter(entry => !existing.some(item => item.id === entry.id || item.content === entry.content))]);
  };
  return <section aria-label="个人记忆" className="space-y-3 rounded border border-line bg-canvas p-4">
    <h3 className="font-semibold">个人记忆</h3>
    <p className="text-sm text-ink-subtle">保存到服务器私人目录，按账号隔离；中台会话不能读取。AI只读，清空后不再参与后续请求。</p>
    {document?.entries.map(entry => <div key={entry.id} className="flex justify-between gap-3"><span>{entry.content}</span>
      <button type="button" disabled={busy} onClick={() => void update(document.entries.filter(item => item.id !== entry.id))}>删除</button></div>)}
    <input aria-label="新增记忆内容" className="rounded border border-line p-2" value={draft} maxLength={500} onChange={e => setDraft(e.target.value)} />
    <Button disabled={busy || !document || !draft.trim()} onClick={add}>添加</Button>
    <Button disabled={busy || !document?.entries.length} onClick={() => setConfirm("clear")}>全部清空</Button>
    {legacy.length > 0 ? <div className="space-y-2 text-sm"><p>检测到旧浏览器记忆，尚未上传。导入成功后可自行清理旧副本。</p>
      <details><summary>查看待导入的 {legacy.length} 条记忆</summary>{legacy.map(entry => <p key={entry.id}>{entry.content}</p>)}</details>
      <Button disabled={busy || !document} onClick={() => setConfirm("import")}>导入旧浏览器记忆</Button></div> : null}
    {error ? <p role="alert">{error}</p> : null}
    {confirm ? <ConfirmDialog open title={confirm === "clear" ? "清空服务器个人记忆" : "导入浏览器记忆"}
      description={confirm === "clear" ? "仅清空本人服务器记忆，完成后不再注入回答。" : "将上方列出的旧记忆上传到本人服务器目录，重复条目跳过；不会自动删除本地副本。"}
      confirmLabel="确认" onCancel={() => setConfirm(null)} onConfirm={() => confirm === "clear" ? void update([]) : importLegacy()} /> : null}
  </section>;
}
