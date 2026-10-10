"use client";

import { useState } from "react";

import { getMyReputation } from "@/api/reputation";
import { timeAgo } from "@/features/questions/timeAgo";
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Pagination,
} from "@/shared/components";
import { useAsyncData } from "@/shared/hooks/useAsyncData";

const PAGE_SIZE = 10;

// 变动列（§2.12）：正数红 +、负数绿 −；0 中性展示
function DeltaCell({ delta }: { delta: number }) {
  if (delta > 0) return <span className="font-medium text-danger-ink">+{delta}</span>;
  if (delta < 0) return <span className="font-medium text-success-ink">{delta}</span>;
  return <span className="text-ink-subtle">{delta}</span>;
}

// 声望流水（§2.12 右 7 列）：时间 · 事件 · 变动（红+/绿-）· 余额，分页
export function ReputationLedger() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error, reload } = useAsyncData(
    () => getMyReputation({ page, page_size: PAGE_SIZE }),
    [page],
  );

  if (isLoading) {
    return (
      <section className="rounded-lg border border-line bg-canvas p-5">
        <LoadingSkeleton variant="list" count={5} />
      </section>
    );
  }

  if (error !== null) {
    return (
      <section className="rounded-lg border border-line bg-canvas p-5">
        <ErrorState message={error} onRetry={reload} />
      </section>
    );
  }

  const summary = data;
  if (summary === null) {
    return (
      <section className="rounded-lg border border-line bg-canvas p-5">
        <ErrorState onRetry={reload} />
      </section>
    );
  }

  // 后端流水无逐行余额字段：余额按「当前总分 − 本页该行之上各行变动之和」推算（仅第 1 页精确）。
  // TODO(接口差异)：后端 ReputationLogItem 补 balance 字段后改为直接展示
  const rows = summary.logs.map((log, index) => {
    const priorDelta = summary.logs
      .slice(0, index)
      .reduce((sum, prior) => sum + prior.delta, 0);
    return { ...log, balance: summary.score - priorDelta };
  });

  return (
    <section className="rounded-lg border border-line bg-canvas p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[16px] font-semibold text-ink">声望流水</h2>
        <p className="text-[13px] text-ink-muted">
          当前声望{" "}
          <span className="text-[18px] font-semibold text-ink">{summary.score}</span>
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="暂无声望变动"
            description="回答被采纳、内容收到投票都会产生声望流水。"
          />
        </div>
      ) : (
        <>
          <table className="mt-3 w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[12px] text-ink-subtle">
                <th scope="col" className="py-2 font-medium">
                  时间
                </th>
                <th scope="col" className="py-2 font-medium">
                  事件
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  变动
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  余额
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((row, index) => (
                <tr key={`${row.created_at}-${row.ref_type}-${row.ref_id}-${index}`}>
                  <td className="py-2.5 pr-2 text-ink-muted">{timeAgo(row.created_at)}</td>
                  <td className="py-2.5 pr-2 text-ink">{row.reason}</td>
                  <td className="py-2.5 text-right">
                    <DeltaCell delta={row.delta} />
                  </td>
                  <td className="py-2.5 text-right text-ink-muted">{row.balance}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] text-ink-subtle">共 {summary.total} 条</p>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              total={summary.total}
              onChange={setPage}
            />
          </div>
        </>
      )}
    </section>
  );
}
