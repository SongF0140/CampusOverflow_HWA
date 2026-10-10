"use client";

import { useState } from "react";

import {
  listAssistantCertifications,
  reviewAssistantCertification,
  type AssistantCertItem,
} from "@/api/users";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Modal,
  Pagination,
  TabNav,
  Textarea,
  Toast,
  UserLine,
  type ToastTone,
} from "@/shared/components";
import {
  ASSISTANT_CERT_COMMENT_MAX_LEN,
  CERT_STATUS,
  type CertStatus,
} from "@/shared/constants/domain";
import { toErrorMessage, useAsyncData } from "@/shared/hooks/useAsyncData";
import { formatRelativeTime } from "@/shared/utils/format";

/**
 * 教师端「助教板块」（页面控件级设计说明 §3.3 底部）：研究生助教认证申请的列表与审核。
 * 权限以后端为准：list / review 都是 require_roles("teacher")（管理员也会 403），
 * 所以本组件只由课程管理页在 role === teacher 时渲染，不向助教/管理员暴露假入口。
 */
const TABS = [
  { key: CERT_STATUS.pending, label: "待审核" },
  { key: CERT_STATUS.approved, label: "已通过" },
  { key: CERT_STATUS.rejected, label: "已驳回" },
];

const EMPTY_TEXT: Record<string, { title: string; description: string }> = {
  [CERT_STATUS.pending]: {
    title: "暂无待审核申请",
    description: "研究生提交助教认证申请后会出现在这里。",
  },
  [CERT_STATUS.approved]: {
    title: "暂无已通过的助教",
    description: "审核通过的申请会保留在这里备查。",
  },
  [CERT_STATUS.rejected]: {
    title: "暂无已驳回的申请",
    description: "被驳回的申请可以重新提交。",
  },
};

const PAGE_SIZE = 20;

export function AssistantCertReviewBoard() {
  const [tab, setTab] = useState<CertStatus>(CERT_STATUS.pending);
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState<{ tone: ToastTone; message: string } | null>(null);
  const [confirm, setConfirm] = useState<{
    item: AssistantCertItem;
    action: "approve" | "reject";
  } | null>(null);
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const state = useAsyncData(
    () => listAssistantCertifications({ status: tab, page, page_size: PAGE_SIZE }),
    [tab, page],
  );

  // 关弹窗时一并清空意见：取消/失败后再次打开不应带着上一次输入
  function closeDialog() {
    setConfirm(null);
    setComment("");
  }

  async function handleConfirm(): Promise<void> {
    // 提交中重复点击（或快速双击）直接忽略：保证一次弹窗只发一个审核请求
    if (!confirm || isSubmitting) return;
    setIsSubmitting(true);
    try {
      // 审核意见可选：空串按"未填写"提交（后端 comment 仅入审计日志）
      await reviewAssistantCertification(
        confirm.item.user_id,
        confirm.action,
        comment.trim() || null,
      );
      setToast({
        tone: "success",
        message: confirm.action === "approve" ? "已通过助教认证" : "已驳回该申请",
      });
      closeDialog();
      state.reload();
    } catch (caught) {
      setToast({ tone: "error", message: toErrorMessage(caught) });
      closeDialog();
    } finally {
      setIsSubmitting(false);
    }
  }

  const emptyText = EMPTY_TEXT[tab];

  return (
    <section className="mt-2 flex flex-col gap-3 rounded-lg border border-line bg-canvas p-5">
      <div>
        <h2 className="text-[16px] font-semibold text-ink">助教板块 · 认证审核</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
          研究生提交助教认证申请后在此审核；
          <span className="text-ink">通过后立即赋予助教能力位</span>
          （学生端出现助教板块），驳回后该用户可重新申请。
        </p>
      </div>

      {toast ? <Toast tone={toast.tone} message={toast.message} onClose={() => setToast(null)} /> : null}

      <TabNav
        tabs={TABS}
        active={tab}
        onChange={(key) => {
          setTab(key as CertStatus);
          setPage(1);
        }}
      />

      {state.isLoading ? <LoadingSkeleton variant="list" count={3} /> : null}

      {!state.isLoading && state.error !== null ? (
        <ErrorState message={state.error} onRetry={state.reload} />
      ) : null}

      {!state.isLoading && state.error === null && state.data !== null ? (
        state.data.items.length === 0 ? (
          <EmptyState title={emptyText.title} description={emptyText.description} />
        ) : (
          <>
            <ul className="flex flex-col">
              {state.data.items.map((item) => (
                <li
                  key={item.user_id}
                  className="flex min-h-[64px] flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-b-0"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    {/* 申请列表接口不含角色字段；能进入本表的人必为学生（后端 ensure_can_apply 限定） */}
                    <UserLine userId={item.user_id} nickname={item.username} role="student" />
                    <span className="text-[12px] text-ink-subtle">
                      {item.applied_at ? `申请于 ${formatRelativeTime(item.applied_at)}` : "申请时间未知"}
                    </span>
                  </div>
                  {tab === CERT_STATUS.pending ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button variant="ghost" onClick={() => setConfirm({ item, action: "reject" })}>
                        驳回
                      </Button>
                      <Button onClick={() => setConfirm({ item, action: "approve" })}>通过</Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            <Pagination
              page={state.data.page}
              pageSize={state.data.page_size}
              total={state.data.total}
              onChange={setPage}
              className="mt-1"
            />
          </>
        )
      ) : null}

      <Modal
        open={confirm !== null}
        title={confirm?.action === "reject" ? "驳回该助教认证申请？" : "通过该助教认证申请？"}
        onClose={closeDialog}
        // 提交进行中锁死关闭路径：审核请求无法取消，中途关掉就能再开另一条申请并发提交（并行改状态 + 列表刷新竞态）
        dismissible={!isSubmitting}
        footer={
          <>
            <Button variant="ghost" onClick={closeDialog} disabled={isSubmitting}>
              取消
            </Button>
            <Button
              variant={confirm?.action === "reject" ? "danger" : "primary"}
              isLoading={isSubmitting}
              onClick={() => void handleConfirm()}
            >
              {confirm?.action === "reject" ? "确认驳回" : "确认通过"}
            </Button>
          </>
        }
      >
        <p>
          {confirm?.action === "reject"
            ? `驳回后「${confirm?.item.username ?? ""}」不能使用助教能力位，可重新提交申请。`
            : `通过后「${confirm?.item.username ?? ""}」立即获得助教能力位，可在学生端标记推荐回答。`}
        </p>
        <div className="mt-4">
          <Textarea
            label="审核意见（可选）"
            rows={3}
            maxLength={ASSISTANT_CERT_COMMENT_MAX_LEN}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="填写驳回或通过的理由，便于事后追溯"
            hint={`${comment.length}/${ASSISTANT_CERT_COMMENT_MAX_LEN} 字，仅记录在审计日志，不会展示给申请人`}
          />
        </div>
      </Modal>

      {isSubmitting ? (
        <span className="sr-only" role="status">
          正在提交审核结果
        </span>
      ) : null}
    </section>
  );
}
