"use client";

import { useEffect, useState } from "react";

import { fetchAnswers } from "@/api/questions";
import type { AnswerListItem, AnswerListResult, AnswerSort } from "@/shared/types/question";

export const ANSWER_PAGE_SIZE = 20;
type LoadStatus = "loading" | "ready" | "error";
interface Selection { context: string; page: number; hash: string }
interface PageState extends AnswerListResult {
  context: string;
  status: LoadStatus;
  targetId: number | null;
  targetMissing: boolean;
}

function parseAnswerHash(hash: string): number | null {
  const match = /^#answer-([1-9]\d*)$/.exec(hash);
  const id = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(id) ? id : null;
}

async function loadAnswerPage(
  questionId: number, sort: AnswerSort, page: number, targetId: number | null,
  isCancelled: () => boolean,
) {
  const first = await fetchAnswers(questionId, sort, page, ANSWER_PAGE_SIZE);
  let result = first;
  if (targetId !== null) {
    let nextPage = page;
    while (!isCancelled()) {
      if (result.items.some((answer) => answer.id === targetId)) {
        return { result, targetId, targetMissing: false };
      }
      // 以本次首次读取的总数为边界，避免持续新增回答导致扫描永远追不上末页。
      if (!result.items.length || nextPage * ANSWER_PAGE_SIZE >= Math.min(first.total, result.total)) break;
      result = await fetchAnswers(questionId, sort, ++nextPage, ANSWER_PAGE_SIZE);
    }
    return { result: first, targetId: null, targetMissing: true };
  }
  const lastPage = Math.max(1, Math.ceil(result.total / ANSWER_PAGE_SIZE));
  if (page > lastPage && !isCancelled()) {
    result = await fetchAnswers(questionId, sort, lastPage, ANSWER_PAGE_SIZE);
  }
  return { result, targetId: null, targetMissing: false };
}

function useHashSelection(context: string, setSelection: (value: Selection) => void) {
  useEffect(() => {
    const onHashChange = () => setSelection({ context, page: 1, hash: window.location.hash });
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [context, setSelection]);
}

function useAnswerLoader(
  questionId: number, sort: AnswerSort, reloadToken: number, enabled: boolean,
  context: string, selection: Selection | null, setState: (value: PageState) => void,
) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const selected = selection?.context === context ? selection : null;
      const targetId = parseAnswerHash(selected?.hash ?? window.location.hash);
      const page = targetId === null ? selected?.page ?? 1 : 1;
      setState({ context, items: [], total: 0, page, status: "loading", targetId: null, targetMissing: false });
      try {
        const loaded = await loadAnswerPage(questionId, sort, page, targetId, () => cancelled);
        if (!cancelled) setState({ context, ...loaded.result, status: "ready", targetId: loaded.targetId, targetMissing: loaded.targetMissing });
      } catch {
        if (!cancelled) setState({ context, items: [], total: 0, page, status: "error", targetId: null, targetMissing: false });
      }
    })();
    return () => { cancelled = true; };
  }, [questionId, sort, reloadToken, enabled, context, selection, setState]);
}

export function useAnswerPagination(
  questionId: number, sort: AnswerSort, reloadToken: number, identity: string,
  enabled: boolean,
) {
  const context = `${questionId}:${sort}:${identity}`;
  const [selection, setSelection] = useState<Selection | null>(null);
  const [state, setState] = useState<PageState>({
    context: "", items: [], total: 0, page: 1, status: "loading",
    targetId: null, targetMissing: false,
  });
  useHashSelection(context, setSelection);
  useAnswerLoader(questionId, sort, reloadToken, enabled, context, selection, setState);
  useEffect(() => {
    if (enabled && state.context === context && state.status === "ready" && state.targetId !== null) {
      document.getElementById(`answer-${state.targetId}`)?.scrollIntoView?.({ block: "start" });
    }
  }, [enabled, context, state.context, state.status, state.targetId, state.page]);

  function changePage(page: number) {
    if (parseAnswerHash(window.location.hash) !== null) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
    setSelection({ context, page, hash: "" });
  }

  function setAnswers(update: (items: AnswerListItem[]) => AnswerListItem[]) {
    setState((current) => ({ ...current, items: update(current.items) }));
  }

  const isCurrent = enabled && state.context === context;
  return {
    answers: isCurrent ? state.items : [], setAnswers,
    total: isCurrent ? state.total : 0, page: isCurrent ? state.page : 1,
    status: isCurrent ? state.status : "loading",
    targetMissing: isCurrent && state.targetMissing, changePage,
  };
}
