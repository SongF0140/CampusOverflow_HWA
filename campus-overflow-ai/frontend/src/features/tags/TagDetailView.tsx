"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchTag } from "@/api/tags";
import { toErrorMessage } from "@/shared/hooks/useAsyncData";
import { QuestionList } from "@/features/questions/QuestionList";
import { ErrorState, LoadingSkeleton } from "@/shared/components";
import { TAG_TYPE_LABEL, type TagType } from "@/shared/constants/domain";
import type { TagListItem } from "@/shared/types/tag";
import type { QuestionSort } from "@/shared/types/question";

type LoadStatus = "loading" | "ready" | "error";

/**
 * 标签详情（P-S06）：直接读取 GET /api/tags/{id}，不存在时展示错误态。
 * 零关联问题仍是有效标签，不用全量标签列表猜测资源是否存在。
 */
export function TagDetailView({
  tagId,
  initialKeyword = "",
  initialSort = "latest",
  initialUnresolved = false,
  initialPage = 1,
}: {
  tagId: number;
  initialKeyword?: string;
  initialSort?: QuestionSort;
  initialUnresolved?: boolean;
  initialPage?: number;
}) {
  const [tag, setTag] = useState<TagListItem | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [reloadToken, setReloadToken] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 先让出一次微任务：避免在 effect 中同步 setState（react-hooks/set-state-in-effect）
      await Promise.resolve();
      if (cancelled) return;
      setStatus("loading");
      try {
        const result = await fetchTag(tagId);
        if (cancelled) return;
        setTag(result);
        setStatus("ready");
      } catch (caught) {
        if (!cancelled) {
          setError(toErrorMessage(caught));
          setStatus("error");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tagId, reloadToken]);

  if (status === "loading") {
    return <LoadingSkeleton variant="detail" count={2} />;
  }

  if (status === "error") {
    return (
      <ErrorState
        message={error ?? "标签加载失败，请检查网络后重试。"}
        onRetry={() => setReloadToken((token) => token + 1)}
      />
    );
  }

  const typeLabel = tag ? TAG_TYPE_LABEL[tag.type as TagType] : undefined;

  return (
    <div className="flex flex-col gap-5">
      <nav className="text-[12px] text-ink-subtle" aria-label="面包屑">
        <Link href="/" className="co-focusable hover:text-brand">
          问题广场
        </Link>
        <span className="mx-1.5" aria-hidden="true">
          /
        </span>
        <span>标签</span>
      </nav>

      <header className="rounded-lg border border-line bg-canvas p-6">
        <h1 className="text-[22px] font-semibold text-ink">{tag?.name ?? `标签 #${tagId}`}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-subtle">
          {typeLabel ? (
            <span className="rounded-sm bg-panel px-2 py-0.5 text-ink-muted">{typeLabel}</span>
          ) : null}
          {tag ? <span>{tag.question_count} 个问题</span> : <span>未找到标签资料</span>}
        </p>
      </header>

      <QuestionList
        tagId={tagId}
        initialKeyword={initialKeyword}
        initialSort={initialSort}
        initialUnresolved={initialUnresolved}
        initialPage={initialPage}
        title="标签下的问题"
        headingLevel="h2"
        basePath={`/tags/${tagId}`}
      />
    </div>
  );
}
