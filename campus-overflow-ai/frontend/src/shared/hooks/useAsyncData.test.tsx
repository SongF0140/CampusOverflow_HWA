import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/client";

import { isUnauthorizedError, toErrorMessage, useAsyncData } from "./useAsyncData";

describe("useAsyncData", () => {
  it("加载中 isLoading=true，成功后写入 data 并关闭 loading", async () => {
    const fetcher = vi.fn(async () => ({ id: 1 }));

    const { result } = renderHook(() => useAsyncData(fetcher, []));
    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual({ id: 1 });
    expect(result.current.error).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("ApiError 时 error 为后端中文 message", async () => {
    const fetcher = vi.fn(async () => {
      throw new ApiError(403, "仅负责教师可认证");
    });

    const { result } = renderHook(() => useAsyncData(fetcher, []));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("仅负责教师可认证");
  });

  it("非 ApiError 时降级为通用中文提示", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("network broken");
    });

    const { result } = renderHook(() => useAsyncData(fetcher, []));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    // Error 自带 message 时透传，不带 message 的走兜底文案
    expect(toErrorMessage(new Error("network broken"))).toBe("network broken");
    expect(toErrorMessage("boom")).toBe("服务暂时不可用，请稍后重试");
    expect(isUnauthorizedError(new ApiError(401, "未登录"))).toBe(true);
    expect(isUnauthorizedError(new ApiError(403, "禁止"))).toBe(false);
  });

  it("deps 变化时自动重取", async () => {
    const fetcher = vi.fn(async (id: number) => ({ id }));

    const { result, rerender } = renderHook(
      ({ id }: { id: number }) => useAsyncData(() => fetcher(id), [id]),
      { initialProps: { id: 1 } },
    );
    await waitFor(() => expect(result.current.data).toEqual({ id: 1 }));

    rerender({ id: 2 });
    await waitFor(() => expect(result.current.data).toEqual({ id: 2 }));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reload 手动重取，且竞态下旧响应不覆盖新响应", async () => {
    // 用可控 resolver 模拟两次都挂起的请求，避免依赖真实时序
    const resolvers: Array<(value: number) => void> = [];
    const fetcher = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const { result } = renderHook(() => useAsyncData(fetcher, []));
    // 放行首个 effect 的启动微任务，让第 1 次调用发生
    await act(async () => {
      await Promise.resolve();
    });

    // 第一次请求尚未返回时触发 reload
    act(() => {
      result.current.reload();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    // 第二次请求先完成
    await act(async () => {
      resolvers[1]?.(2);
    });
    await waitFor(() => expect(result.current.data).toBe(2));

    // 旧响应迟到，不应覆盖
    await act(async () => {
      resolvers[0]?.(999);
    });
    expect(result.current.data).toBe(2);
  });
});
