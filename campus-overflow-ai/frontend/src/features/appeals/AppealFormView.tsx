"use client";

// 封禁申诉面板（页面控件级设计说明 §2.15）：
// 封禁信息回显自 session me（后端 UserResponse 仅含 status/ban_reason，封禁时间字段后端暂无，
// 二期补充后回显）；申诉理由 ≥30 字校验 + 计数；提交走二期 T-15 约定路径 POST /api/appeals，
// 本期后端为 501/404 占位 → 统一兜底文案，失败不清空已输入内容
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ApiError, apiFetch } from "@/api/client";
import { Button, Card, EmptyState, LoadingSkeleton, Textarea, Toast } from "@/shared/components";
import { useSessionStore } from "@/shared/stores/session-store";

const REASON_MIN = 30;
// 申诉接口为二期 T-15（governance 501 占位）：404/501/网络错误统一用此兜底文案
const APPEAL_UNAVAILABLE = "申诉接口尚未开放，请稍后再试";
// 成功后停留片刻展示 Toast，再跳通知中心（§2.15：成功 Toast → /notifications）
const REDIRECT_DELAY_MS = 1500;

// 理由校验（提交时使用）：不足 30 字给出行内提示
export function validateReason(value: string): string | null {
  const length = value.trim().length;
  if (length < REASON_MIN) return `申诉理由至少 ${REASON_MIN} 字，当前 ${length} 字`;
  return null;
}

export function AppealFormView() {
  const router = useRouter();
  const me = useSessionStore((state) => state.me);
  const sessionStatus = useSessionStore((state) => state.status);

  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  if (sessionStatus === "loading") {
    return <LoadingSkeleton variant="detail" count={2} />;
  }
  if (me === null) {
    // middleware 已守卫登录，此分支为会话探测失败（401 等）的兜底
    return <EmptyState title="登录状态已失效" description="请重新登录后再提交申诉。" />;
  }
  if (me.status !== "banned") {
    return (
      <div className="flex flex-col gap-3">
        <EmptyState
          title="你的账号状态正常，无需申诉"
          description="只有处于封禁状态的账号才能发起申诉。"
        />
        <Link
          href="/"
          className="co-focusable self-start text-[13px] text-ink-muted underline-offset-2 transition-colors duration-150 ease-standard hover:text-ink hover:underline"
        >
          返回首页
        </Link>
      </div>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const nextReasonError = validateReason(reason);
    setReasonError(nextReasonError);
    setSubmitError(null);
    if (nextReasonError !== null) return;

    setIsSubmitting(true);
    try {
      // 二期 T-15 申诉接口（governance 501 占位）：本期路径约定 POST /api/appeals（经 BFF），字段蛇形
      await apiFetch("/appeals", {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      setSuccessToast("已提交，结果将在通知中告知");
      window.setTimeout(() => router.push("/notifications"), REDIRECT_DELAY_MS);
    } catch (caught) {
      // 失败不清空输入：用户可修改后重试
      if (caught instanceof ApiError && caught.code !== 404 && caught.code < 500) {
        setSubmitError(caught.message); // 400/403 等业务错误透传后端中文原因
      } else {
        setSubmitError(APPEAL_UNAVAILABLE); // 501 占位 / 404 未实现 / 网络错误
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {successToast ? (
        <Toast tone="success" message={successToast} onClose={() => setSuccessToast(null)} />
      ) : null}

      <Card>
        <dl className="flex flex-col gap-2 text-[14px]">
          <div className="flex gap-2">
            <dt className="shrink-0 text-ink-subtle">账号状态</dt>
            <dd className="font-medium text-danger-ink">已封禁</dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 text-ink-subtle">封禁原因</dt>
            <dd className="text-ink">{me.ban_reason ?? "未记录封禁原因"}</dd>
          </div>
        </dl>
        {/* TODO（二期 T-15）：后端 UserResponse 暂无封禁时间字段（banned_until/banned_at），补充后在此回显封禁时间 */}
      </Card>

      <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <div>
          <Textarea
            label="申诉理由"
            value={reason}
            rows={6}
            placeholder="请说明你认为封禁有误的原因、相关背景与诉求（不少于 30 字）…"
            error={reasonError ?? undefined}
            onChange={(event) => {
              setReason(event.target.value);
              if (reasonError !== null) setReasonError(null);
            }}
          />
          <p className="mt-1 text-right text-[12px] text-ink-subtle" aria-live="polite">
            已输入 {reason.trim().length} 字 / 至少 {REASON_MIN} 字
          </p>
        </div>

        {submitError ? (
          <p role="alert" className="text-[13px] text-danger-ink">
            {submitError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => router.back()} disabled={isSubmitting}>
            取消
          </Button>
          <Button type="submit" isLoading={isSubmitting}>
            {isSubmitting ? "提交中…" : "提交申诉"}
          </Button>
        </div>
      </form>
    </div>
  );
}
