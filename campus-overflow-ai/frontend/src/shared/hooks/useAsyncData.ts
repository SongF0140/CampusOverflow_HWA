"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/api/client";

const FALLBACK_MESSAGE = "服务暂时不可用，请稍后重试";

// 任意抛错统一转中文消息：ApiError 用后端 message，其余用通用兜底
export function toErrorMessage(caught: unknown): string {
  if (caught instanceof ApiError) return caught.message;
  if (caught instanceof Error && caught.message) return caught.message;
  return FALLBACK_MESSAGE;
}

// 401 判断辅助：是否该由调用方触发 redirectToLogin（hooks 不自动跳转）
export function isUnauthorizedError(caught: unknown): boolean {
  return caught instanceof ApiError && caught.isUnauthorized;
}

export interface AsyncData<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  reload: () => void;
}

// 通用异步数据加载：deps 变化自动重取，返回三态 + 手动 reload
// 注意 401 不会自动跳登录，由调用方依据 error/isUnauthorizedError 处理
export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[],
): AsyncData<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // 用请求序号防止慢响应覆盖新响应（竞态保护）
  const requestSeq = useRef(0);

  // deps 序列化为 key 参与依赖比较；fetcher 每次渲染都是新引用，不能进依赖数组
  const depsKey = JSON.stringify(deps);

  useEffect(() => {
    const seq = ++requestSeq.current;
    let active = true;

    async function run(): Promise<void> {
      // 先让出同步执行栈再置位启动态：react-hooks 禁止在 effect 内同步 setState
      await Promise.resolve();
      if (!active || requestSeq.current !== seq) return;
      setIsLoading(true);
      setError(null);
      try {
        const result = await fetcher();
        if (!active || requestSeq.current !== seq) return;
        setData(result);
        setIsLoading(false);
      } catch (caught) {
        if (!active || requestSeq.current !== seq) return;
        setError(toErrorMessage(caught));
        setIsLoading(false);
      }
    }

    void run();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps 由调用方以数组传入
  }, [depsKey, reloadKey]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  return { data, isLoading, error, reload };
}
