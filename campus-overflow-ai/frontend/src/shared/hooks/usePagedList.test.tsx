import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";
import type { Paged } from "@/shared/types/common";

import { usePagedList } from "./usePagedList";

interface Row {
  id: number;
  title: string;
}

interface Query {
  course_id?: number;
  keyword?: string;
}

function makePage(page: number, keyword?: string): Paged<Row> {
  return {
    items: [{ id: page, title: keyword ?? `第${page}页` }],
    total: 5,
    page,
    page_size: 20,
  };
}

describe("usePagedList", () => {
  it("初始加载第 1 页并解析 Paged 信封", async () => {
    const fetchPage = vi.fn(async (query: Query & { page: number; page_size: number }) => {
      expect(query.page).toBe(1);
      expect(query.page_size).toBe(20);
      return makePage(1);
    });

    const { result } = renderHook(() => usePagedList<Row, Query>(fetchPage, {}));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items).toEqual([{ id: 1, title: "第1页" }]);
    expect(result.current.total).toBe(5);
    expect(result.current.page).toBe(1);
  });

  it("setPage 翻页时以新页码重取", async () => {
    const fetchPage = vi.fn(async (query: Query & { page: number; page_size: number }) =>
      makePage(query.page),
    );

    const { result } = renderHook(() => usePagedList<Row, Query>(fetchPage, {}));

    await waitFor(() => expect(result.current.page).toBe(1));
    act(() => {
      result.current.setPage(3);
    });

    await waitFor(() => expect(result.current.items).toEqual([{ id: 3, title: "第3页" }]));
    expect(result.current.page).toBe(3);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("setParams 追加条件并重置回第 1 页", async () => {
    const fetchPage = vi.fn(
      async (query: Query & { page: number; page_size: number }) =>
        makePage(query.page, query.keyword),
    );

    const { result } = renderHook(() => usePagedList<Row, Query>(fetchPage, {}));

    await waitFor(() => expect(result.current.page).toBe(1));
    act(() => {
      result.current.setPage(2);
    });
    await waitFor(() => expect(result.current.page).toBe(2));

    act(() => {
      result.current.setParams({ keyword: "红黑树", course_id: 3 });
    });

    await waitFor(() =>
      expect(result.current.items).toEqual([{ id: 1, title: "红黑树" }]),
    );
    expect(result.current.page).toBe(1);
    // 断言蛇形键直传给 fetcher
    expect(fetchPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, page_size: 20, keyword: "红黑树", course_id: 3 }),
    );
  });

  it("接口失败时 error 为后端中文 message，且 items 回落空数组", async () => {
    const fetchPage = vi.fn(async () => {
      throw new ApiError(403, "课程成员列表仅教师可见");
    });

    const { result } = renderHook(() => usePagedList<Row, Query>(fetchPage, {}));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe("课程成员列表仅教师可见");
    expect(result.current.items).toEqual([]);
  });
});
