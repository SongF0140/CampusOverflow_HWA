"use client";

// 标签选择器（页面控件级设计说明 §2.6）：关键词搜索已有标签 + 输入新名内联创建，
// 已选 chip ≤ maxCount（× 移除；超限禁止添加并提示）；AI 推荐暂缓，纯手动
import { useEffect, useState, type KeyboardEvent } from "react";

import { listTags } from "@/api/tags";
import type { TagListItem } from "@/shared/types/tag";

// id 缺省 = 本次输入的新标签名（提交时以字符串入 tag_ids）
export interface PickedTag {
  id?: number;
  name: string;
}

const SEARCH_DEBOUNCE_MS = 300;

function isPicked(value: PickedTag[], candidate: PickedTag): boolean {
  return value.some((tag) =>
    candidate.id !== undefined
      ? tag.id === candidate.id
      : tag.id === undefined && tag.name === candidate.name,
  );
}

export function TagPicker({
  value,
  onChange,
  maxCount = 5,
}: {
  value: PickedTag[];
  onChange: (tags: PickedTag[]) => void;
  maxCount?: number;
}) {
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<TagListItem[]>([]);
  // 候选结果对应的关键词：只展示与当前关键词匹配的候选（防抖窗口期不显示过期结果）
  const [resultsKey, setResultsKey] = useState("");
  const [limitHint, setLimitHint] = useState<string | null>(null);

  const trimmed = keyword.trim();
  const hasResultsForKey = trimmed !== "" && resultsKey === trimmed;
  // 已选中的标签不再出现在候选里（重复添加去重的第一道防线）
  const visibleResults = hasResultsForKey
    ? results.filter((tag) => !isPicked(value, { id: tag.id, name: tag.name }))
    : [];
  const exactNameExists =
    (hasResultsForKey && results.some((tag) => tag.name === trimmed)) ||
    value.some((tag) => tag.name === trimmed);
  const canCreateNew = trimmed !== "" && !exactNameExists;

  // 关键词防抖搜索（tags api keyword 模糊筛名）
  useEffect(() => {
    if (trimmed === "") return;
    let active = true;
    const timer = window.setTimeout(() => {
      listTags({ keyword: trimmed })
        .then((data) => {
          if (active) {
            setResults(data.items);
            setResultsKey(trimmed);
          }
        })
        .catch(() => {
          // 搜索失败视为无候选，可走内联创建
          if (active) {
            setResults([]);
            setResultsKey(trimmed);
          }
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [trimmed]);

  function addTag(tag: PickedTag): void {
    if (value.length >= maxCount) {
      setLimitHint(`最多 ${maxCount} 个标签`);
      return;
    }
    if (isPicked(value, tag)) return; // 重复添加：静默去重
    onChange([...value, tag]);
    setKeyword("");
    setResults([]);
    setLimitHint(null);
  }

  function removeTag(target: PickedTag): void {
    onChange(value.filter((tag) => tag.id !== target.id || tag.name !== target.name));
    setLimitHint(null); // 低于上限后解除"最多 N 个标签"提示
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== "Enter" || trimmed === "") return;
    event.preventDefault();
    const exact = results.find((tag) => tag.name === trimmed);
    addTag(exact ? { id: exact.id, name: exact.name } : { name: trimmed });
  }

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-medium text-ink-muted">标签</span>
        <span className="text-[12px] text-ink-subtle" aria-live="polite">
          {value.length}/{maxCount}
        </span>
      </div>

      {value.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag, index) => (
            <span
              key={tag.id ?? `new-${tag.name}-${index}`}
              className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-3 py-1 text-[12px] font-medium text-brand-strong"
            >
              {tag.name}
              <button
                type="button"
                aria-label={`移除标签 ${tag.name}`}
                onClick={() => removeTag(tag)}
                className="co-focusable cursor-pointer rounded-full px-1 leading-none transition-colors duration-150 ease-standard hover:text-danger"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <input
        type="text"
        aria-label="搜索标签"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        onKeyDown={handleSearchKeyDown}
        placeholder="搜索标签，或输入新名称回车创建"
        className="h-11 w-full rounded-md border border-line bg-canvas px-3 text-[14px] text-ink placeholder:text-ink-subtle transition-colors duration-150 ease-standard focus:outline-2 focus:-outline-offset-1 focus:outline-brand"
      />

      {hasResultsForKey ? (
        <div className="rounded-md border border-line bg-canvas">
          {visibleResults.map((tag) => (
            <button
              key={tag.id}
              type="button"
              onClick={() => addTag({ id: tag.id, name: tag.name })}
              className="co-focusable block w-full cursor-pointer px-3 py-2 text-left text-[13px] text-ink transition-colors duration-150 ease-standard hover:bg-panel"
            >
              {tag.name}
              <span className="ml-2 text-[12px] text-ink-subtle">
                {tag.question_count} 个问题
              </span>
            </button>
          ))}
          {canCreateNew ? (
            <button
              type="button"
              onClick={() => addTag({ name: trimmed })}
              className="co-focusable block w-full cursor-pointer px-3 py-2 text-left text-[13px] text-brand transition-colors duration-150 ease-standard hover:bg-panel"
            >
              创建新标签「{trimmed}」
            </button>
          ) : null}
          {visibleResults.length === 0 && !canCreateNew ? (
            <p className="px-3 py-2 text-[12px] text-ink-subtle">该标签已添加</p>
          ) : null}
        </div>
      ) : null}

      {limitHint ? (
        <p role="alert" className="text-[12px] text-danger-ink">
          {limitHint}
        </p>
      ) : null}
    </div>
  );
}
