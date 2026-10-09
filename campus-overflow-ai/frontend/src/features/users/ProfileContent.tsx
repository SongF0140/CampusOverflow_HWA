"use client";

import Link from "next/link";
import { useState } from "react";

import { fetchUserAnswers, fetchUserQuestions, type UserAnswer } from "@/api/users";
import { QuestionCard } from "@/features/questions/QuestionCard";
import { EmptyState, ErrorState, LoadingSkeleton, Pagination } from "@/shared/components";
import { useAsyncData } from "@/shared/hooks/useAsyncData";
import type { Paged } from "@/shared/types/common";
import type { QuestionListItem } from "@/shared/types/question";

const PAGE_SIZE = 10;

function AnswerSummary({ answer }: { answer: UserAnswer }) {
  return (
    <article className="rounded-lg border border-line bg-canvas p-5">
      <Link
        href={`/questions/${answer.question_id}#answer-${answer.id}`}
        className="co-focusable text-[16px] font-semibold text-ink hover:text-brand"
      >
        {answer.question_title}
      </Link>
      <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-[14px] text-ink-muted">
        {answer.body}
      </p>
      <p className="mt-3 text-[12px] text-ink-subtle">
        {answer.vote_score} 票
        {answer.is_accepted ? " · 已采纳" : ""}
        {answer.certified_by_teacher ? " · 优质内容" : ""}
        {answer.recommended_by_assistant ? " · 助教推荐" : ""}
      </p>
    </article>
  );
}

export function ProfileContent({ userId, tab }: { userId: number; tab: "questions" | "answers" }) {
  const [page, setPage] = useState(1);
  const state = useAsyncData<Paged<QuestionListItem | UserAnswer>>(
    () => tab === "questions"
      ? fetchUserQuestions(userId, page)
      : fetchUserAnswers(userId, page),
    [userId, tab, page],
  );
  if (state.isLoading) return <LoadingSkeleton variant="list" count={5} />;
  if (state.error) return <ErrorState message={state.error} onRetry={state.reload} />;
  if (!state.data) return <ErrorState onRetry={state.reload} />;
  const { items, total } = state.data;
  return (
    <div className="flex flex-col gap-4">
      {items.length === 0 ? (
        <EmptyState
          title={tab === "questions" ? "还没有提问" : "还没有回答"}
          description="该用户暂无可见内容。"
        />
      ) : null}
      {items.map((item) => "question_title" in item
        ? <AnswerSummary key={item.id} answer={item} />
        : <QuestionCard key={item.id} question={item} />)}
      {total > PAGE_SIZE ? (
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
      ) : null}
    </div>
  );
}
