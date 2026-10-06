export const metadata = { title: "工单处理 · CampusOverflow" };

/**
 * 工单处理（P-T04）：治理与工单队列属于第二阶段（后端 /api/governance/** 一期统一 501 占位，
 * 见 tasks.md 一期范围总注），因此本页一期只说明状态，不调用任何接口。
 */
export default function TeacherModerationPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-semibold text-ink">工单处理</h1>
      <div className="rounded-lg border border-line bg-canvas p-6">
        <p className="text-[14px] leading-relaxed text-ink-muted">
          内容治理与工单队列随第二阶段（Agent 服务）上线：
          AI 只负责按风险分级创建待确认工单，处置动作由人工确认后执行。
        </p>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-subtle">
          当前阶段该能力未开放，页面不提供处置入口。
        </p>
      </div>
    </div>
  );
}
