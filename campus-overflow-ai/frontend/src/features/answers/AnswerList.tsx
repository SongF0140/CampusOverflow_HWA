"use client";

import { useEffect, useState } from "react";

import {
  acceptAnswer,
  certifyAnswer,
  deleteAnswer,
  listAnswers,
  recommendAnswer,
  uncertifyAnswer,
  updateAnswer,
} from "@/api/answers";
import { createVote } from "@/api/votes";
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  type ToastTone,
  type VoteDirection,
} from "@/shared/components";
import { toErrorMessage } from "@/shared/hooks/useAsyncData";
import type { Answer, AnswerSort } from "@/shared/types/answer";
import type { VoteTargetType } from "@/shared/types/vote";

import { AnswerCard } from "./AnswerCard";

type ListStatus = "loading" | "ready" | "error";

type ToastFn = (tone: ToastTone, message: string) => void;

// 投票快照：score + 当前用户票向（未投为 0）
export interface VoteSnapshot {
  score: number;
  myVote: 1 | 0 | -1;
}

// 后端 my_vote 为 number，收窄为 VoteWidget 需要的 1 | 0 | -1
export function normalizeMyVote(value: number): 1 | 0 | -1 {
  if (value === 1) return 1;
  if (value === -1) return -1;
  return 0;
}

// 投票提交（US-07 toggle 语义，问题/回答共用）：乐观更新 → 服务端回包校正 → 失败回滚 + Toast
// value 仅 ±1：同方向重复提交即取消，以后端回包为准
export async function submitVoteOptimistic(params: {
  targetType: VoteTargetType;
  targetId: number;
  current: VoteSnapshot;
  direction: VoteDirection;
  apply: (next: VoteSnapshot) => void;
  showToast: ToastFn;
}): Promise<void> {
  const { score, myVote } = params.current;
  const nextMyVote: 1 | 0 | -1 = myVote === params.direction ? 0 : params.direction;
  params.apply({ score: score - myVote + nextMyVote, myVote: nextMyVote });
  try {
    const result = await createVote({
      target_type: params.targetType,
      target_id: params.targetId,
      value: params.direction,
    });
    params.apply({ score: result.vote_score, myVote: normalizeMyVote(result.my_vote) });
  } catch (caught) {
    params.apply({ score, myVote });
    params.showToast("error", toErrorMessage(caught));
  }
}

// 回答列表（§2.7）：排序由父级写入 URL 后传入；发布回答经 refreshSignal 触发重拉
// 采纳/投票/标记类操作本地更新（最小重拉），删除/编辑重拉列表
export function AnswerList({
  questionId,
  sort,
  refreshSignal,
  viewerUsername,
  isAdmin,
  isTeacher,
  isAssistant,
  isLoggedIn,
  canAccept,
  onAccepted,
  onNeedLogin,
  onWriteAnswer,
  onListChanged,
  showToast,
}: {
  questionId: number;
  sort: AnswerSort;
  refreshSignal: number;
  viewerUsername: string | null;
  isAdmin: boolean;
  isTeacher: boolean;
  isAssistant: boolean;
  isLoggedIn: boolean;
  canAccept: boolean;
  onAccepted: (answerId: number, questionStatus: string) => void;
  onNeedLogin: () => void;
  onWriteAnswer: () => void;
  onListChanged: () => void;
  showToast: ToastFn;
}) {
  const [items, setItems] = useState<Answer[]>([]);
  const [status, setStatus] = useState<ListStatus>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 先让出一次微任务：避免在 effect 中同步 setState（react-hooks/set-state-in-effect）
      await Promise.resolve();
      if (cancelled) return;
      setStatus("loading");
      try {
        const result = await listAnswers(questionId, { sort, page_size: 50 });
        if (cancelled) return;
        setItems(result.items);
        setStatus("ready");
      } catch (caught) {
        if (cancelled) return;
        setErrorMessage(toErrorMessage(caught));
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [questionId, sort, reloadToken, refreshSignal]);

  function refetch() {
    setReloadToken((token) => token + 1);
  }

  function patchAnswer(answerId: number, patch: Partial<Answer>) {
    setItems((prev) =>
      prev.map((answer) => (answer.id === answerId ? { ...answer, ...patch } : answer)),
    );
  }

  async function handleVote(answer: Answer, direction: VoteDirection) {
    await submitVoteOptimistic({
      targetType: "answer",
      targetId: answer.id,
      current: { score: answer.vote_score, myVote: normalizeMyVote(answer.my_vote) },
      direction,
      apply: (next) => patchAnswer(answer.id, { vote_score: next.score, my_vote: next.myVote }),
      showToast,
    });
  }

  async function handleAccept(answer: Answer) {
    try {
      const result = await acceptAnswer(answer.id);
      // 回包 {accepted, question_status}：本地更新采纳徽标并联动问题状态
      patchAnswer(answer.id, { is_accepted: result.accepted });
      onAccepted(answer.id, result.question_status);
      showToast("success", "已采纳，作者将收到通知");
    } catch (caught) {
      showToast("error", toErrorMessage(caught));
    }
  }

  async function handleEdit(answer: Answer, body: string): Promise<boolean> {
    try {
      await updateAnswer(answer.id, body);
      showToast("success", "回答已更新");
      refetch();
      return true;
    } catch (caught) {
      showToast("error", toErrorMessage(caught));
      return false;
    }
  }

  async function handleDelete(answer: Answer) {
    try {
      await deleteAnswer(answer.id);
      showToast("success", "回答已删除");
      refetch();
      // 删除已采纳回答会级联撤销采纳，问题状态需同步重拉
      onListChanged();
    } catch (caught) {
      showToast("error", toErrorMessage(caught));
    }
  }

  async function handleCertify(answer: Answer, certify: boolean) {
    try {
      const result = certify
        ? await certifyAnswer(answer.id)
        : await uncertifyAnswer(answer.id);
      patchAnswer(answer.id, { certified_by_teacher: result.certified_by_teacher });
      showToast("success", result.certified_by_teacher ? "已认证为优质内容" : "已取消认证");
    } catch (caught) {
      showToast("error", toErrorMessage(caught));
    }
  }

  async function handleRecommend(answer: Answer) {
    try {
      const result = await recommendAnswer(answer.id, true);
      patchAnswer(answer.id, { recommended_by_assistant: result.recommended_by_assistant });
      showToast("success", "已标记为助教推荐");
    } catch (caught) {
      showToast("error", toErrorMessage(caught));
    }
  }

  if (status === "loading") return <LoadingSkeleton variant="list" count={2} />;

  if (status === "error") {
    return <ErrorState message={errorMessage} onRetry={refetch} />;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="还没有回答"
        description="来写下第一个回答，帮助提问的同学。"
        actionLabel={isLoggedIn ? "写回答" : undefined}
        onAction={isLoggedIn ? onWriteAnswer : undefined}
      />
    );
  }

  return (
    <ul aria-label="回答列表" className="flex flex-col gap-3">
      {items.map((answer) => (
        <li key={answer.id}>
          <AnswerCard
            answer={answer}
            canAccept={canAccept}
            viewerUsername={viewerUsername}
            isAdmin={isAdmin}
            isTeacher={isTeacher}
            isAssistant={isAssistant}
            isLoggedIn={isLoggedIn}
            onNeedLogin={onNeedLogin}
            onVote={(target, direction) => void handleVote(target, direction)}
            onAccept={(target) => handleAccept(target)}
            onEdit={handleEdit}
            onDelete={(target) => handleDelete(target)}
            onCertify={(target, certify) => handleCertify(target, certify)}
            onRecommend={(target) => handleRecommend(target)}
            showToast={showToast}
          />
        </li>
      ))}
    </ul>
  );
}
