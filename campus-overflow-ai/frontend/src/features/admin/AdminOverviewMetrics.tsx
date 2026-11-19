"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchAppeals, fetchModerationCases } from "@/api/governance";
import { listQuestions } from "@/api/questions";
import { listUsers } from "@/api/users";

const METRIC_CARD_CLASS =
  "co-focusable flex items-center justify-between rounded-lg border border-line bg-canvas p-4 transition-colors duration-150 ease-standard hover:border-brand-line";

interface Metric {
  key: string;
  label: string;
  href: string;
}

const METRICS: Metric[] = [
  { key: "users", label: "注册用户", href: "/admin/users" },
  { key: "todayQuestions", label: "今日新增问题", href: "/" },
  { key: "pendingCases", label: "待审工单", href: "/admin/moderation/cases" },
  { key: "agentProposed", label: "待审批", href: "/admin/moderation/approvals" },
  { key: "pendingAppeals", label: "申诉待处理", href: "/admin/moderation/appeals" },
];

function startOfTodayIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

// 治理总览指标（§4.1）：五个数字都来自真实列表接口的 total；单个失败只让该卡显示 "-"，不伪造。
export function AdminOverviewMetrics() {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const page = { page: 1, page_size: 1 };

    Promise.allSettled([
      listUsers(page),
      listQuestions({ ...page, sort: "latest", created_from: startOfTodayIso() }),
      fetchModerationCases({ ...page, status: "pending" }),
      fetchModerationCases({ ...page, status: "agent_proposed" }),
      fetchAppeals({ ...page, status: "pending" }),
    ]).then((results) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      results.forEach((result, index) => {
        const key = METRICS[index].key;
        next[key] = result.status === "fulfilled" ? String(result.value.total) : "-";
      });
      setValues(next);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 min-[1025px]:grid-cols-5">
      {METRICS.map((metric) => (
        <Link key={metric.key} href={metric.href} className={METRIC_CARD_CLASS}>
          <span className="flex items-baseline gap-3">
            <span className="text-[28px] font-semibold leading-none text-ink">
              {values[metric.key] ?? "-"}
            </span>
            <span className="text-[14px] text-ink-muted">{metric.label}</span>
          </span>
          <span aria-hidden="true" className="text-[16px] text-ink-subtle">
            →
          </span>
        </Link>
      ))}
    </div>
  );
}
