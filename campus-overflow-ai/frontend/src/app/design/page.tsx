"use client";

import { useState, type ReactNode } from "react";

import {
  AiSuggestionCard,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  StatusBadge,
  TagChip,
  Toast,
  type AiCardState,
  type StatusTone,
  type ToastTone,
} from "@/shared/components";

const COLOR_TOKENS: Array<{ name: string; value: string; note: string }> = [
  { name: "canvas", value: "#FFFFFF", note: "页面主背景" },
  { name: "panel", value: "#F7F7F7", note: "侧栏 / 表头 / 输入框底" },
  { name: "line", value: "#E5E5E5", note: "1px 描边" },
  { name: "ink", value: "#0A0A0A", note: "标题与正文" },
  { name: "ink-muted", value: "#3A3A3C", note: "说明文字" },
  { name: "ink-subtle", value: "#888888", note: "时间 / 计数（下限）" },
  { name: "brand", value: "#0F766E", note: "主按钮 / 焦点环 / 链接" },
  { name: "brand-strong", value: "#115E59", note: "按下 / 悬停" },
  { name: "brand-soft", value: "#CCFBF1", note: "选中底 / AI 卡片底" },
  { name: "success", value: "#16A34A", note: "成功" },
  { name: "warning", value: "#D97706", note: "警告" },
  { name: "danger", value: "#DC2626", note: "危险 / 高风险" },
];

const STATUS_TONES: StatusTone[] = ["unresolved", "resolved", "risk", "hidden"];
const AI_STATES: AiCardState[] = ["loading", "error", "ready"];

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-canvas p-6">
      <h2 className="text-[20px] font-semibold text-ink">{title}</h2>
      {desc ? <p className="mt-1 text-[13px] text-ink-muted">{desc}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function DesignSamplePage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>(["数据结构"]);
  const [toast, setToast] = useState<{ tone: ToastTone; message: string } | null>(null);

  const toggleTag = (tag: string) =>
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));

  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-6 px-8 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-[30px] font-semibold text-ink">设计系统样例页</h1>
        <p className="text-[13px] text-ink-muted">
          对应 <code className="rounded-sm bg-panel px-1">docs/前端架构/设计系统.md</code>。用于验收颜色、圆角、三态与 AI 卡片三种状态。
        </p>
      </header>

      <Section title="颜色 token" desc="强调色只用于主按钮、焦点环、链接强调；不做区块背景或卡片填充。">
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {COLOR_TOKENS.map((token) => (
            <li key={token.name} className="flex items-center gap-3 rounded-md border border-line p-3">
              <span
                className="h-8 w-8 shrink-0 rounded-sm border border-line"
                style={{ backgroundColor: token.value }}
                aria-hidden="true"
              />
              <span className="flex flex-col">
                <span className="text-[13px] font-medium text-ink">{token.name}</span>
                <span className="text-[11px] text-ink-subtle">{token.value}</span>
                <span className="text-[11px] text-ink-muted">{token.note}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="按钮与圆角" desc="按钮 8px 矩形（不做胶囊）；悬停 150ms 只改颜色，不做缩放。">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="co-focusable cursor-pointer rounded-md bg-brand px-4 py-2 text-[14px] font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-strong"
          >
            主按钮
          </button>
          <button
            type="button"
            className="co-focusable cursor-pointer rounded-md border border-line bg-canvas px-4 py-2 text-[14px] font-medium text-ink transition-colors duration-150 ease-standard hover:bg-panel"
          >
            次按钮
          </button>
          <button
            type="button"
            className="co-focusable cursor-pointer rounded-md border border-danger-line bg-canvas px-4 py-2 text-[14px] font-medium text-danger transition-colors duration-150 ease-standard hover:bg-danger-soft"
          >
            危险操作
          </button>
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded-md bg-line px-4 py-2 text-[14px] font-medium text-ink-subtle"
          >
            已禁用
          </button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            className="co-focusable h-11 w-[280px] rounded-md border border-line bg-canvas px-3 text-[14px] text-ink transition-colors duration-150 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
            placeholder="输入框（聚焦为强调色描边）"
          />
          <span className="rounded-sm bg-panel px-2 py-1 text-[12px] text-ink-muted">圆角 4 小件</span>
          <span className="rounded-md bg-panel px-2 py-1 text-[12px] text-ink-muted">圆角 8 控件</span>
          <span className="rounded-lg bg-panel px-2 py-1 text-[12px] text-ink-muted">圆角 12 卡片</span>
        </div>
      </Section>

      <Section title="状态徽标与标签" desc="状态必须色块 + 文字，不能只靠颜色。">
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_TONES.map((tone) => (
            <StatusBadge key={tone} tone={tone} />
          ))}
          <TagChip label="只读标签" />
          {["数据结构", "操作系统", "计算机网络"].map((tag) => (
            <TagChip
              key={tag}
              label={tag}
              selected={selectedTags.includes(tag)}
              onClick={() => toggleTag(tag)}
            />
          ))}
        </div>
      </Section>

      <Section title="加载 / 空 / 错误三态" desc="加载用骨架屏微光，不用整页转圈；空状态给一个主操作。">
        <div className="grid gap-4 lg:grid-cols-3">
          <div>
            <p className="mb-2 text-[12px] font-medium text-ink-muted">加载中</p>
            <LoadingSkeleton variant="list" count={2} />
          </div>
          <div>
            <p className="mb-2 text-[12px] font-medium text-ink-muted">空状态</p>
            <EmptyState
              title="这门课还没有人提问"
              description="成为第一个提问的人，帮同学也帮自己。"
              actionLabel="去提问"
              onAction={() => setToast({ tone: "info", message: "这里是演示，不会真的跳转" })}
            />
          </div>
          <div>
            <p className="mb-2 text-[12px] font-medium text-ink-muted">错误</p>
            <ErrorState
              message="服务暂时不可用，请稍后重试。你填写的内容已保留。"
              onRetry={() => setToast({ tone: "success", message: "已重新加载" })}
            />
          </div>
        </div>
      </Section>

      <Section title="AI 建议卡片（三种状态）" desc="浅底 + 虚线边 + 固定标注；未勾选确认前不写入任何数据。">
        <div className="grid gap-4 lg:grid-cols-3">
          {AI_STATES.map((state) => (
            <div key={state}>
              <p className="mb-2 text-[12px] font-medium text-ink-muted">
                {state === "loading" ? "生成中" : state === "error" ? "失败可重试" : "待人工确认"}
              </p>
              <AiSuggestionCard
                title="推荐标签"
                state={state}
                items={[
                  { id: "t1", label: "数据结构", reason: "正文出现 3 次", confidence: 0.86 },
                  { id: "t2", label: "算法", reason: "与站内 5 个问题相似", confidence: 0.61 },
                ]}
                onRetry={() => setToast({ tone: "info", message: "重新请求 AI 建议" })}
                onConfirm={(ids) => setToast({ tone: "success", message: `已确认写入 ${ids.length} 个标签` })}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section title="二次确认与提示条" desc="删除 / 封禁类操作一律二次确认；操作结果用提示条反馈。">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="co-focusable cursor-pointer rounded-md border border-danger-line bg-canvas px-4 py-2 text-[14px] font-medium text-danger transition-colors duration-150 ease-standard hover:bg-danger-soft"
          >
            打开二次确认弹窗
          </button>
          <button
            type="button"
            onClick={() => setToast({ tone: "success", message: "操作成功" })}
            className="co-focusable cursor-pointer rounded-md border border-line px-4 py-2 text-[13px] font-medium text-ink transition-colors duration-150 ease-standard hover:bg-panel"
          >
            成功提示
          </button>
          <button
            type="button"
            onClick={() => setToast({ tone: "error", message: "操作失败，请稍后重试" })}
            className="co-focusable cursor-pointer rounded-md border border-line px-4 py-2 text-[13px] font-medium text-ink transition-colors duration-150 ease-standard hover:bg-panel"
          >
            失败提示
          </button>
        </div>
        {toast ? (
          <div className="mt-4">
            <Toast tone={toast.tone} message={toast.message} onClose={() => setToast(null)} />
          </div>
        ) : null}
      </Section>

      <ConfirmDialog
        open={dialogOpen}
        title="确认删除这条问题？"
        description="删除后普通用户将无法看到该问题及其回答。此操作会记录操作者与时间。"
        confirmLabel="删除"
        danger
        onCancel={() => setDialogOpen(false)}
        onConfirm={() => {
          setDialogOpen(false);
          setToast({ tone: "success", message: "已删除（演示）" });
        }}
      />
    </main>
  );
}
