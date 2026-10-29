"use client";
import { useState } from "react";
import { confirmClassChange, fetchClassChange, type ClassChange } from "@/api/class-changes";
import { Button, LoadingSkeleton, ErrorState } from "@/shared/components";
import { useAsyncData, toErrorMessage } from "@/shared/hooks/useAsyncData";

export function ClassChangeView({ courseId, requestId }: { courseId: number; requestId: string }) {
  const listing = useAsyncData(() => fetchClassChange(requestId), [requestId]);
  const [result, setResult] = useState<ClassChange | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const data = result ?? listing.data;
  const decide = async (operation: "confirm" | "cancel") => {
    setBusy(true); setError("");
    try { setResult(await confirmClassChange(requestId, operation)); }
    catch (caught) { setError(toErrorMessage(caught)); }
    finally { setBusy(false); }
  };
  if (listing.isLoading) return <LoadingSkeleton />;
  if (listing.error || !data) return <ErrorState message={listing.error ?? "未找到变更申请"} onRetry={listing.reload} />;
  if (data.course_id !== courseId) return <p role="alert">变更清单与当前课程不一致</p>;
  const stateText = { pending: "待负责教师确认", executed: "已执行", cancelled: "已取消", expired: "已过期" };
  return <section className="space-y-4 rounded-lg border border-line p-5">
    <h1 className="text-xl font-semibold">班级名单变更确认</h1>
    <p>{data.course_name} · {stateText[data.status]}</p>
    <p>以下清单由 Agent 提出，确认前不会修改成员。仅本课程负责教师或管理员可以确认。</p>
    <ul className="space-y-2">{data.students.map(student => <li key={student.user_id}>
      <span>{student.username}</span>（ID {student.user_id}，{student.joined ? "已在班级" : "尚未加入"}）→ {data.action === "add" ? "加入班级" : "移出班级"}
    </li>)}</ul>
    {error && <p role="alert">{error}</p>}
    {data.status === "pending" && <div className="flex gap-3">
      <Button disabled={busy} onClick={() => void decide("confirm")}>{data.action === "add" ? "确认加入班级" : "确认移出班级"}</Button>
      <Button disabled={busy} variant="ghost" onClick={() => void decide("cancel")}>取消变更</Button>
    </div>}
  </section>;
}
