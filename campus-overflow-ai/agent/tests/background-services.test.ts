import { expect, it, vi } from "vitest";
import { createBackgroundServices } from "../src/runtime/background-services.js";

it("并发启动只初始化一次，重复关闭只清理一次", async () => {
  const stop = vi.fn();
  const start = vi.fn(async () => stop);
  const runtime = createBackgroundServices([start]);
  await Promise.all([runtime.start(), runtime.start(), runtime.start()]);
  await Promise.all([runtime.close(), runtime.close()]);
  expect(start).toHaveBeenCalledTimes(1);
  expect(stop).toHaveBeenCalledTimes(1);
  await expect(runtime.start()).rejects.toThrow();
});

it("关闭等待在途初始化，迟到的MCP句柄也会关闭", async () => {
  let release!: (stop: () => void) => void;
  const stop = vi.fn();
  const late = new Promise<() => void>(resolve => { release = resolve; });
  const runtime = createBackgroundServices([() => late]);
  const starting = runtime.start();
  const closing = runtime.close();
  release(stop);
  await Promise.all([starting, closing]);
  expect(stop).toHaveBeenCalledTimes(1);
});

it("初始化失败逆序回滚，不能留下半启动的定时器", async () => {
  const calls: string[] = [];
  const skipped = vi.fn();
  const runtime = createBackgroundServices([
    () => () => { calls.push("knowledge"); },
    () => () => { calls.push("patrol"); },
    () => { throw new Error("MCP invalid"); },
    skipped,
  ]);
  await expect(runtime.start()).rejects.toThrow("MCP invalid");
  expect(calls).toEqual(["patrol", "knowledge"]);
  expect(skipped).not.toHaveBeenCalled();
  await runtime.close();
  expect(calls).toEqual(["patrol", "knowledge"]);
});

it("某项关闭失败也会清理其他资源，调用者可观察失败", async () => {
  const stopped = vi.fn();
  const runtime = createBackgroundServices([
    () => stopped,
    () => async () => { throw new Error("close failed"); },
  ]);
  await runtime.start();
  await expect(runtime.close()).rejects.toThrow();
  expect(stopped).toHaveBeenCalledTimes(1);
});

it("启动失败且回滚失败时保留两者错误", async () => {
  const runtime = createBackgroundServices([
    () => () => { throw new Error("rollback failed"); },
    () => { throw new Error("start failed"); },
  ]);
  const error = await runtime.start().catch((failure: unknown) => failure);
  expect(error).toBeInstanceOf(AggregateError);
  expect((error as AggregateError).errors.map((item: Error) => item.message)).toEqual(["start failed", "rollback failed"]);
});

it("尚未启动即可关闭，之后不再启动任何服务", async () => {
  const start = vi.fn();
  const runtime = createBackgroundServices([start]);
  await runtime.close();
  await expect(runtime.start()).rejects.toThrow();
  expect(start).not.toHaveBeenCalled();
});
