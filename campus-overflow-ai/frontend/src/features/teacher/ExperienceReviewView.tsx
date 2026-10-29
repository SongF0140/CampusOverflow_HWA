"use client";

import { useState } from "react";

import { fetchExperienceProposals, reviewExperience } from "@/api/experiences";
import { Button, ErrorState, LoadingSkeleton } from "@/shared/components";
import { toErrorMessage, useAsyncData } from "@/shared/hooks/useAsyncData";

const STATUS_TEXT = { pending: "待教师确认", published: "已发布", rejected: "已拒绝", withdrawn: "已撤回" };

export function ExperienceReviewView({ courseId }: { courseId: number }) {
  const listing = useAsyncData(() => fetchExperienceProposals(courseId), [courseId]);
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const decide = async (id: number, action: "publish" | "reject" | "withdraw") => {
    setBusy(id); setMessage(""); setError("");
    try {
      await reviewExperience(id, action);
      setMessage("经验状态已更新");
      listing.reload();
    } catch (caught) { setError(toErrorMessage(caught)); }
    finally { setBusy(null); }
  };
  return (
    <section className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold text-ink">回答流程经验</h1>
        <p className="text-sm text-ink-muted">Agent 提交建议，由本课程负责教师确认后发布。已发布经验供本课程回答参考，可随时撤回。</p>
      </header>
      {message && <p role="status" className="text-sm text-brand">{message}</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {listing.isLoading ? <LoadingSkeleton /> : listing.error ? (
        <ErrorState message={listing.error} onRetry={listing.reload} />
      ) : listing.data?.items.length ? (
        <ul className="space-y-4">
          {listing.data.items.map(item => (
            <li key={item.id} className="space-y-3 rounded-lg border border-line bg-canvas p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-semibold text-ink">{item.title}</h2>
                <span className="text-xs text-ink-muted">{STATUS_TEXT[item.status]}</span>
              </div>
              <p className="whitespace-pre-wrap text-sm text-ink-muted">{item.summary}</p>
              <ol className="list-inside list-decimal space-y-1 text-sm text-ink">
                {item.steps.map((step, index) => <li key={index}>{step}</li>)}
              </ol>
              <div className="flex gap-2">
                {item.status === "pending" && <>
                  <Button disabled={busy !== null} onClick={() => void decide(item.id, "publish")}>确认发布</Button>
                  <Button variant="ghost" disabled={busy !== null} onClick={() => void decide(item.id, "reject")}>拒绝建议</Button>
                </>}
                {item.status === "published" && <Button variant="ghost" disabled={busy !== null} onClick={() => void decide(item.id, "withdraw")}>撤回发布</Button>}
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="rounded-lg border border-line p-6 text-sm text-ink-muted">暂无回答经验建议</p>}
    </section>
  );
}
