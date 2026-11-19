"use client";
import { useEffect, useRef, useState } from "react";
import { approvalRequest, readApprovalRecord, saveApprovalRecord,
  type ApprovalDraft, type ApprovalPreview, type ApprovalRecord, type ApprovalWait } from "./approval-request-client";

export function useApprovalRequest(userId: number) {
  const [draft, setDraft] = useState<ApprovalDraft>({ target_type: "question", target_id: 0, action: "hide", reason: "" });
  const [preview, setPreview] = useState<ApprovalPreview | null>(null);
  const [record, setRecord] = useState<ApprovalRecord | null>(() => readApprovalRecord(userId));
  const [wait, setWait] = useState<ApprovalWait | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingIdRef = useRef<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  useEffect(() => () => { generationRef.current += 1; controllerRef.current?.abort(); }, []);
  const updateDraft = (next: ApprovalDraft) => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    setBusy(false); setPreview(null); setDraft(next); setError(null);
    pendingIdRef.current = null;
  };
  const perform = async (work: (signal: AbortSignal, current: () => boolean) => Promise<void>) => {
    generationRef.current += 1;
    const generation = generationRef.current;
    controllerRef.current?.abort();
    const controller = new AbortController(); controllerRef.current = controller;
    const current = () => generationRef.current === generation && !controller.signal.aborted;
    setBusy(true); setError(null);
    try { await work(controller.signal, current); }
    catch (caught) { if (current()) setError(caught instanceof Error ? caught.message : "审批请求失败，请重试"); }
    finally { if (current()) setBusy(false); }
  };
  const loadPreview = () => perform(async (signal, current) => {
    setPreview(null);
    const data = await approvalRequest<ApprovalPreview>("preview", signal, draft);
    if (current()) setPreview(data);
  });
  const submit = () => perform(async (signal, current) => {
    if (!preview?.can_request_approval) return;
    const requestId = pendingIdRef.current ?? crypto.randomUUID();
    pendingIdRef.current = requestId;
    const pending = { request_id: requestId };
    saveApprovalRecord(userId, pending); setRecord(pending); setWait(null);
    const data = await approvalRequest<ApprovalRecord>("requests", signal, {
      ...draft, request_id: requestId, expected_version: preview.state_version,
    });
    if (current()) {
      const saved = { request_id: requestId, case_id: data.case_id, ...(data.contract_version === 2 ? { contract_version: 2 as const } : {}) };
      saveApprovalRecord(userId, saved); setRecord(saved); setPreview(null);
    }
  });
  const refresh = (action?: "resume" | "cancel") => perform(async (signal, current) => {
    if (!record) return;
    const path = `requests/${encodeURIComponent(record.request_id)}${action ? `/${action}` : ""}`;
    const data = await approvalRequest<ApprovalWait>(path, signal, action ? {} : undefined);
    if (current()) {
      setWait(data);
      if (data.contract_version === 2) {
        const saved: ApprovalRecord = { request_id: data.request_id, case_id: data.case_id, contract_version: 2 };
        saveApprovalRecord(userId, saved); setRecord(saved);
      }
    }
  });
  return { draft, updateDraft, preview, record, wait, busy, error, loadPreview, submit, refresh };
}
