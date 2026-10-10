import Link from "next/link";

import { Button, EmptyState } from "@/shared/components";

// TODO(接口差异)：后端无治理聚合指标接口，五个指标数字一律以"-"占位；接口就绪后接入替换
const METRIC_CARDS = [
  { label: "注册用户", href: "/admin/users" },
  { label: "今日新增问题", href: "/" },
  { label: "待审工单", href: "/admin/moderation/cases" },
  { label: "待审批", href: "/admin/moderation/approvals" },
  { label: "申诉待处理", href: "/admin/moderation/appeals" },
];

// 快捷入口卡（§4.1）：Agent 运行为二期预留，不在路由表中渲染为可点项
const QUICK_ENTRIES = [
  { label: "用户治理", description: "检索用户、封禁与解禁", href: "/admin/users" },
  { label: "课程治理", description: "查看与管理全站课程", href: "/admin/courses" },
  { label: "审核队列", description: "处理人工举报与 AI 发起的工单", href: "/admin/moderation/cases" },
  { label: "审批中心", description: "确认或驳回处置工单", href: "/admin/moderation/approvals" },
];

const METRIC_CARD_CLASS =
  "co-focusable flex items-center justify-between rounded-lg border border-line bg-canvas p-4 transition-colors duration-150 ease-standard hover:border-brand-line";

// 治理总览（页面控件级设计说明 §4.1）：指标卡一行×5 + 左快捷入口 + 右最近事件流
// 登录与管理员守卫由 src/proxy.ts 服务端完成
export function AdminOverviewView() {
  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-[22px] font-semibold text-ink">治理总览</h2>

      {/* TODO(接口差异)：后端无治理聚合指标接口，数值以"-"占位，卡片保留可点导航 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 min-[1025px]:grid-cols-5">
        {METRIC_CARDS.map((card) => (
          <Link key={card.label} href={card.href} className={METRIC_CARD_CLASS}>
            <span className="flex items-baseline gap-3">
              <span className="text-[28px] font-semibold leading-none text-ink">-</span>
              <span className="text-[14px] text-ink-muted">{card.label}</span>
            </span>
            <span aria-hidden="true" className="text-[16px] text-ink-subtle">
              →
            </span>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-canvas p-4">
          <h3 className="text-[16px] font-semibold text-ink">快捷入口</h3>
          <ul className="flex flex-col gap-2">
            {QUICK_ENTRIES.map((entry) => (
              <li key={entry.href}>
                <Link
                  href={entry.href}
                  className="co-focusable flex items-center justify-between gap-3 rounded-md border border-line bg-canvas px-4 py-3 transition-colors duration-150 ease-standard hover:border-brand-line"
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[14px] font-medium text-ink">{entry.label}</span>
                    <span className="text-[12px] text-ink-subtle">{entry.description}</span>
                  </span>
                  <span aria-hidden="true" className="text-[16px] text-ink-subtle">
                    →
                  </span>
                </Link>
              </li>
            ))}
            <li>
              {/* TODO(二期)：Agent 运行记录页（/admin/agent/runs）随 Agent 服务开放 */}
              <Button variant="ghost" disabled title="随 Agent 服务开放" className="w-full justify-between">
                Agent 运行
                <span className="rounded-sm bg-warning-soft px-1.5 py-0.5 text-[11px] font-medium text-warning-ink">
                  二期
                </span>
              </Button>
            </li>
          </ul>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-line bg-canvas p-4">
          <h3 className="text-[16px] font-semibold text-ink">最近事件</h3>
          {/* TODO(接口差异)：后端无审计事件读接口，接入后渲染封禁/解禁/处置/申诉时间线（含操作者与 trace id 摘要） */}
          <EmptyState
            title="暂无治理事件"
            description="接入审计日志后，这里将展示封禁、解禁、处置与申诉动作的时间线。"
          />
        </section>
      </div>
    </div>
  );
}
