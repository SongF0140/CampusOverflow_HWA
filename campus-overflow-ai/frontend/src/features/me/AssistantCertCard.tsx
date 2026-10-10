"use client";

import { useState } from "react";

import { applyAssistantCertification } from "@/api/users";
import { Button, Toast, type ToastTone } from "@/shared/components";
import { CERT_STATUS, USER_ROLE, type CertStatus } from "@/shared/constants/domain";
import { toErrorMessage } from "@/shared/hooks/useAsyncData";
import { useSessionStore } from "@/shared/stores/session-store";

/**
 * 助教认证申请入口（US-20 / Q-07 / T-02a）。
 * 状态门槛与后端 identity/domain.ensure_can_apply 一致：仅学生可申请，
 * pending / approved 不可重复申请（禁重复），rejected 可重新申请。
 * 本科生也可提交——申请本身就是"声明研究生身份"，是否属实由教师审核把关。
 */
const STATUS_VIEW: Record<CertStatus, { label: string; hint: string; className: string }> = {
  none: {
    label: "未申请",
    hint: "助教认证通过后可标记推荐回答，协助教师答疑。",
    className: "bg-panel text-ink-muted",
  },
  pending: {
    label: "审核中",
    hint: "申请已提交，等待教师审核；审核期间不能重复提交。",
    className: "bg-warning-soft text-warning-ink",
  },
  approved: {
    label: "已通过",
    hint: "你已获得助教能力位，可在问题详情里标记推荐回答。",
    className: "bg-success-soft text-success-ink",
  },
  rejected: {
    label: "已驳回",
    hint: "本次申请未通过，可以重新提交申请。",
    className: "bg-danger-soft text-danger-ink",
  },
};

export function AssistantCertCard() {
  const me = useSessionStore((state) => state.me);
  const loadMe = useSessionStore((state) => state.loadMe);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ tone: ToastTone; message: string } | null>(null);

  // 仅学生可申请（后端 ensure_can_apply 同样限定 role == student）
  if (!me || me.role !== USER_ROLE.student) return null;

  const view = STATUS_VIEW[me.assistant_cert_status];
  const canApply =
    me.assistant_cert_status !== CERT_STATUS.pending &&
    me.assistant_cert_status !== CERT_STATUS.approved;

  async function handleApply(): Promise<void> {
    setIsSubmitting(true);
    try {
      await applyAssistantCertification();
      setToast({ tone: "success", message: "申请已提交，等待教师审核" });
      // 申请成功后刷新登录态：助理认证状态立即反映到本卡片与顶栏
      await loadMe();
    } catch (caught) {
      setToast({ tone: "error", message: toErrorMessage(caught) });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="rounded-lg border border-line bg-canvas p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-ink">助教认证</h2>
        <span className={`inline-flex items-center rounded-sm px-2 py-0.5 text-[12px] font-medium ${view.className}`}>
          {view.label}
        </span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">{view.hint}</p>
      {toast ? (
        <div className="mt-3">
          <Toast tone={toast.tone} message={toast.message} onClose={() => setToast(null)} />
        </div>
      ) : null}
      <div className="mt-4">
        {canApply ? (
          <Button onClick={() => void handleApply()} isLoading={isSubmitting}>
            {me.assistant_cert_status === CERT_STATUS.rejected ? "重新申请" : "申请助教认证"}
          </Button>
        ) : (
          // 不可重复申请：禁用 + 说明，不提供假入口（补完计划：pending/approved 禁重复）
          <Button disabled title={view.hint}>
            {me.assistant_cert_status === CERT_STATUS.approved ? "认证已通过" : "审核中，暂不可重复申请"}
          </Button>
        )}
      </div>
    </section>
  );
}
