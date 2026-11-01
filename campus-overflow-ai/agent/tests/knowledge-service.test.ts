import { expect, it, vi } from "vitest";
import { startKnowledgeService } from "../src/runtime/agent-services.js";

it("关闭等待目录在途初始化，不能留下迟到的watcher", async () => {
  let release!: () => void;
  let isWatching = false;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const catalog = { start: vi.fn(async () => { await pending; isWatching = true; }),
    stop: vi.fn(() => { isWatching = false; }) };
  const close = startKnowledgeService(catalog);
  expect(catalog.start).toHaveBeenCalledTimes(1);
  const closing = close();
  release();
  await closing;
  expect(isWatching).toBe(false);
});

it("没有知识目录配置时可以正常启动和关闭", async () => {
  await startKnowledgeService(undefined)();
});
