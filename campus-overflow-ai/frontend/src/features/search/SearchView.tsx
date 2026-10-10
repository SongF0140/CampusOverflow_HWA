"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { search } from "@/api/search";
import { QuestionCard } from "@/features/questions/QuestionCard";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Pagination,
} from "@/shared/components";
import { usePagedList } from "@/shared/hooks/usePagedList";
import type { Paged } from "@/shared/types/common";
import type { QuestionListItem } from "@/shared/types/question";

import {
  clearSearchHistory,
  loadSearchHistory,
  removeSearchKeyword,
  saveSearchKeyword,
} from "./history";

const PAGE_SIZE = 10;

// 空关键词不发请求：返回空页，让页面走"输入关键词"引导空态
function fetchSearchPage(query: {
  q: string;
  page: number;
  page_size: number;
}): Promise<Paged<QuestionListItem>> {
  if (!query.q) {
    return Promise.resolve({
      items: [],
      total: 0,
      page: query.page,
      page_size: query.page_size,
    });
  }
  return search({ q: query.q, page: query.page, page_size: query.page_size });
}

interface SearchQuery {
  keyword: string;
  page: number;
}

function parsePositiveInt(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

// URL 参数解析：q 为主（顶栏搜索框写入，spec「发现」），keyword 为兼容别名；默认值不写入 URL
function parseSearchQuery(params: URLSearchParams): SearchQuery {
  const keyword = (params.get("q") ?? params.get("keyword") ?? "").trim();
  return { keyword, page: parsePositiveInt(params.get("page")) ?? 1 };
}

function buildSearchPath(query: SearchQuery): string {
  const params = new URLSearchParams();
  if (query.keyword) params.set("q", query.keyword);
  if (query.page > 1) params.set("page", String(query.page));
  const queryString = params.toString();
  return queryString ? `/search?${queryString}` : "/search";
}

function querySignature(query: SearchQuery): string {
  return `${query.keyword}|${query.page}`;
}

// 搜索记录页主组件（§2.17）：搜索框（自动聚焦/保留关键词）+ 历史 chips + 结果区（问题卡+分页）
// 关键词与页码写 URL（?q=&page=），刷新可回填；列表同步统一由 URL 变化驱动
// （深链页码由下方 URL 同步 effect 在挂载时应用，server 壳无需回传 page）
export function SearchView({ initialKeyword }: { initialKeyword: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [inputValue, setInputValue] = useState(initialKeyword);
  // 已应用的搜索词（驱动结果区分支）；URL 里的关键词在测试/深链场景外与其一致
  const [activeKeyword, setActiveKeyword] = useState(initialKeyword);
  // 历史只在客户端挂载后读取，避免 SSR/CSR 首帧不一致
  const [history, setHistory] = useState<string[]>([]);

  const {
    items,
    total,
    page,
    pageSize,
    isLoading,
    error,
    reload,
    setParams,
    setPage,
  } = usePagedList(fetchSearchPage, { q: initialKeyword }, PAGE_SIZE);

  // appliedRef 记录已应用的查询签名：内部提交先行标记，URL effect 到来时跳过，避免双拉
  const appliedRef = useRef<string>(querySignature({ keyword: initialKeyword, page: 1 }));

  useEffect(() => {
    let active = true;
    // 先让出同步执行栈再 setState（同 QuestionForm 草稿恢复：避免 effect 内级联渲染）；
    // 不能用 useState 惰性初始化，SSR 预渲染时 window 不存在
    void Promise.resolve().then(() => {
      if (active) setHistory(loadSearchHistory(window.localStorage));
    });
    return () => {
      active = false;
    };
  }, []);

  // URL → 列表同步：仅响应外部变化（浏览器回退/前进、顶栏搜索）
  useEffect(() => {
    const next = parseSearchQuery(searchParams);
    const signature = querySignature(next);
    if (signature === appliedRef.current) return;
    appliedRef.current = signature;
    setActiveKeyword(next.keyword);
    if (next.page > 1) {
      // setParams + setPage 同批提交，只触发一次重取（深链直达第 N 页）
      setParams({ q: next.keyword });
      setPage(next.page);
    } else {
      setParams({ q: next.keyword }); // setParams 内部会重置回第 1 页
    }
  }, [searchParams, setParams, setPage]);

  // 外部关键词变化同步回输入框（提交写入的值与本轮一致，无感）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // 先让出同步执行栈：避免在 effect 中同步 setState（react-hooks/set-state-in-effect）
      await Promise.resolve();
      if (!cancelled) setInputValue(activeKeyword);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeKeyword]);

  const handleSearch = useCallback(
    (rawKeyword: string) => {
      const keyword = rawKeyword.trim();
      if (!keyword) return;
      // 新搜索先写历史（置顶去重），再应用查询并写 URL
      setHistory(saveSearchKeyword(window.localStorage, keyword));
      appliedRef.current = querySignature({ keyword, page: 1 });
      setActiveKeyword(keyword);
      setParams({ q: keyword });
      router.replace(buildSearchPath({ keyword, page: 1 }));
    },
    [router, setParams],
  );

  const handlePageChange = useCallback(
    (nextPage: number) => {
      appliedRef.current = querySignature({ keyword: activeKeyword, page: nextPage });
      setPage(nextPage);
      router.replace(buildSearchPath({ keyword: activeKeyword, page: nextPage }));
    },
    [activeKeyword, router, setPage],
  );

  const handleAsk = useCallback(() => {
    // 空态"直接提问"引导；未登录由 middleware 拦截跳登录
    router.push("/questions/new");
  }, [router]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    handleSearch(inputValue);
  }

  const hasKeyword = activeKeyword !== "";
  const isReady = !isLoading && error === null;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[22px] font-semibold text-ink">搜索记录</h1>

      {/* 搜索框：自动聚焦、保留关键词（§2.17） */}
      <form role="search" onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="搜索问题关键词"
          aria-label="搜索问题"
          autoFocus
          className="co-focusable h-10 w-full max-w-[520px] rounded-md border border-line bg-canvas px-3 text-[14px] text-ink transition-colors duration-150 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20"
        />
        <Button type="submit">搜索</Button>
      </form>

      {/* 搜索历史 chips：逐条可删 + 一键清空；历史为空隐藏整块 */}
      {history.length > 0 ? (
        <section
          aria-label="搜索历史"
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-[13px] text-ink-muted">搜索历史</span>
          {history.map((keyword) => (
            <span
              key={keyword}
              className="inline-flex items-center rounded-full border border-line bg-panel"
            >
              <button
                type="button"
                onClick={() => handleSearch(keyword)}
                className="co-focusable cursor-pointer rounded-l-full py-1 pl-3 pr-1.5 text-[13px] text-ink transition-colors duration-150 ease-standard hover:text-brand"
              >
                {keyword}
              </button>
              <button
                type="button"
                aria-label={`删除搜索历史 ${keyword}`}
                onClick={() => setHistory(removeSearchKeyword(window.localStorage, keyword))}
                className="co-focusable cursor-pointer rounded-r-full py-1 pl-0.5 pr-2.5 text-[12px] text-ink-subtle transition-colors duration-150 ease-standard hover:text-danger"
              >
                ×
              </button>
            </span>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setHistory(clearSearchHistory(window.localStorage))}>
            清空历史
          </Button>
        </section>
      ) : null}

      {/* TODO(AI 二期)：搜索结果 AI 摘要与智能推荐槽位，随 Agent 服务开放 */}
      <section aria-label="搜索结果" className="flex flex-col gap-4">
        {!hasKeyword ? (
          <EmptyState
            title="输入关键词，搜索站内问题"
            description="支持按问题全文检索，试试课程名、知识点或报错信息。"
            actionLabel="直接提问"
            onAction={handleAsk}
          />
        ) : isLoading ? (
          <LoadingSkeleton variant="list" count={5} />
        ) : error !== null ? (
          <ErrorState message={error} onRetry={reload} />
        ) : items.length === 0 ? (
          <EmptyState
            title="未找到相关内容，换个关键词试试"
            description="可以简化关键词再搜一次，或直接发起提问让同学和老师来解答。"
            actionLabel="直接提问"
            onAction={handleAsk}
          />
        ) : (
          <>
            <ul className="flex flex-col gap-3">
              {items.map((question) => (
                <li key={question.id}>
                  <QuestionCard question={question} />
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[12px] text-ink-subtle">共 {total} 条</p>
              <Pagination page={page} pageSize={pageSize} total={total} onChange={handlePageChange} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
