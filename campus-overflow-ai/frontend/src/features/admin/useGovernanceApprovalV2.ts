"use client";
import { useEffect, useRef, useState } from "react";
import { useSessionStore } from "@/shared/stores/session-store";
import { readGovernanceApproval, decideGovernanceApproval, type GovernanceApprovalV2 } from "@/api/governance-v2";
import { ApiError } from "@/api/client";

export function useGovernanceApprovalV2(requestId: string) {
  const owner = useSessionStore(state => state.me?.role === "admin" ? state.me.id : undefined);
  const [record, setRecord] = useState<{ owner: number; item: GovernanceApprovalV2 } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mutating = useRef(false);
  const current = (version: number, signal: AbortSignal) => sequence.current === version && !signal.aborted
    && useSessionStore.getState().me?.id === owner && useSessionStore.getState().me?.role === "admin";
  const refresh = async () => {
    if (owner === undefined || mutating.current) return;
    if (!requestId) { setError("版本化工单快照损坏，请联系管理员核对"); return; }
    const version = ++sequence.current;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    try {
      const item = await readGovernanceApproval(requestId, abort.signal);
      if (current(version, abort.signal)) { setRecord({ owner, item }); setError(null); }
    } catch (caught) { if (current(version, abort.signal)) setError(caught instanceof ApiError ? caught.message : "状态查询失败，请稍后核对"); }
  };
  useEffect(() => {
    let active = true;
    mutating.current = false;
    queueMicrotask(() => { if (active) setBusy(false); });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const invalidate = () => { sequence.current++; controller.current?.abort(); };
    const tick = async () => { await refresh(); if (active) timer = setTimeout(() => void tick(), 5_000); };
    void tick();
    return () => { active = false; clearTimeout(timer); invalidate(); };
    // 轮询闭包只由账号与申请变化重建，写操作通过ref暂停轮询。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, requestId]);
  const decide = async (frozen: GovernanceApprovalV2, operation: "approve" | "reject" | "cancel", note: string) => {
    if (owner === undefined || mutating.current) return;
    if (frozen.request_id !== requestId) { setError("申请已切换，请重新核对冻结清单"); return; }
    mutating.current = true; setBusy(true); setError(null);
    const version = ++sequence.current;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    try {
      const item = await decideGovernanceApproval(frozen, operation, note, abort.signal);
      if (current(version, abort.signal)) setRecord({ owner, item });
    } catch (caught) { if (current(version, abort.signal)) setError(caught instanceof ApiError ? caught.message : "提交结果待核对，请先查询状态，不要重复创建动作"); }
    finally { if (sequence.current === version) mutating.current = false; if (current(version, abort.signal)) setBusy(false); }
  };
  return { item: record && record.owner === owner && record.item.request_id === requestId ? record.item : null, error, busy, refresh, decide, owner };
}
