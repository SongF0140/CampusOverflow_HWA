"use client";

import { MarkdownBody } from "@/shared/components";
import type { AnswerListItem } from "@/shared/types/question";

import { formatRelativeTime } from "./mock";
import { VoteControl } from "./VoteControl";

export function AnswerCard({
  answer,
  canAccept,
  onAccept,
  onVote,
}: {
  answer: AnswerListItem;
  canAccept: boolean;
  onAccept: (answerId: number) => void;
  onVote: (answerId: number, value: 1 | -1) => void;
}) {
  return (
    <article
      id={`answer-${answer.id}`}
      className={`flex gap-4 rounded-lg border bg-canvas p-5 ${
        answer.is_accepted ? "border-success/40" : "border-line"
      }`}
    >
      <VoteControl
        score={answer.vote_score}
        myVote={answer.my_vote}
        label={`回答 ${answer.id} 的票数`}
        onVote={(value) => onVote(answer.id, value)}
      />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-subtle">
          {answer.is_accepted ? (
            <span className="rounded-sm bg-success-soft px-2 py-0.5 font-medium text-success-ink">
              已采纳
            </span>
          ) : null}
          {answer.recommended_by_assistant ? (
            <span className="rounded-sm bg-brand-soft px-2 py-0.5 font-medium text-brand-strong">
              助教推荐
            </span>
          ) : null}
          {answer.certified_by_teacher ? (
            <span className="rounded-sm bg-brand-soft px-2 py-0.5 font-medium text-brand-strong">
              优质内容
            </span>
          ) : null}
          <span className="text-ink-muted">{answer.author}</span>
          <span aria-hidden="true">·</span>
          <span>{formatRelativeTime(answer.created_at)}</span>
        </div>

        <div className="mt-3">
          <MarkdownBody content={answer.body} />
        </div>

        {canAccept && !answer.is_accepted ? (
          <button
            type="button"
            onClick={() => onAccept(answer.id)}
            className="co-focusable mt-3 cursor-pointer rounded-md border border-line bg-canvas px-3 py-1.5 text-[13px] font-medium text-ink transition-colors duration-150 ease-standard hover:bg-panel"
          >
            采纳这个回答
          </button>
        ) : null}
      </div>
    </article>
  );
}
