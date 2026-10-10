"use client";

import { useCallback, useState } from "react";

import { useAsyncData } from "./useAsyncData";
import type { Paged } from "@/shared/types/common";

// 分页请求函数：接收合并后的完整查询（含 page/page_size），返回分页信封
export type PageFetcher<T, P extends object> = (
  query: P & { page: number; page_size: number },
) => Promise<Paged<T>>;

export interface PagedList<T, P extends object> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
  setPage: (page: number) => void;
  // 追加筛选参数并重置回第 1 页
  setParams: (params: Partial<P>) => void;
}

// 分页列表 hook：基于 useAsyncData，翻页/改参数自动重取，含竞态保护
export function usePagedList<T, P extends object>(
  fetchPage: PageFetcher<T, P>,
  initialParams: P,
  initialPageSize = 20,
): PagedList<T, P> {
  const [params, setParamsState] = useState<P>(initialParams);
  const [page, setPageState] = useState(1);
  const pageSize = initialPageSize;

  const fetcher = useCallback(
    () => fetchPage({ ...params, page, page_size: pageSize }),
    [fetchPage, params, page, pageSize],
  );

  const { data, isLoading, error, reload } = useAsyncData<Paged<T>>(fetcher, [
    params,
    page,
    pageSize,
  ]);

  const setPage = useCallback((next: number) => setPageState(next), []);

  const setParams = useCallback((partial: Partial<P>) => {
    setParamsState((prev) => ({ ...prev, ...partial }));
    // 改筛选条件后回到第 1 页；若已在第 1 页，params 变化本身会触发重取
    setPageState(1);
  }, []);

  return {
    items: data?.items ?? [],
    total: data?.total ?? 0,
    page,
    pageSize,
    isLoading,
    error,
    reload,
    setPage,
    setParams,
  };
}
