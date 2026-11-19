// P1 夜间定时：配置边界、下次触发、默认关闭、到期执行、失败续排与停止。
import { afterEach, describe, expect, it, vi } from "vitest";

import type { UserInternalClient } from "../src/internal-client.js";
import type { KnowledgeCatalog } from "../src/knowledge/catalog.js";
import { readSnapshotMetrics, resetSnapshotMetrics } from "../src/knowledge/snapshot-metrics.js";
import {
  loadNightlyConfig, nextNightlyOccurrence, startNightlyConsolidationScheduler,
} from "../src/scheduler/nightly-scheduler.js";

const clientOf = () => ({
  audit: {
    createRun: vi.fn().mockResolvedValue("run-nightly"),
    finishRun: vi.fn().mockResolvedValue(undefined),
  },
  expirePatrolNotes: vi.fn().mockResolvedValue({ expired: 0 }),
  fetchPatrolFeedback: vi.fn().mockResolvedValue([]),
  createPatrolNotes: vi.fn(),
} as unknown as UserInternalClient);

const config = {
  enabled: true, hour: 2, minute: 0, days: 14,
  snapshotEnabled: false, qaSnapshotEnabled: false,
};

afterEach(() => {
  vi.useRealTimers();
  resetSnapshotMetrics();
});

describe("夜间配置", () => {
  it("默认关闭，越界回退默认值", () => {
    expect(loadNightlyConfig({})).toEqual({
      enabled: false, hour: 1, minute: 0, days: 14,
      snapshotEnabled: false, qaSnapshotEnabled: false,
    });
    expect(loadNightlyConfig({
      NIGHTLY_CONSOLIDATION_HOUR: "99",
      NIGHTLY_CONSOLIDATION_MINUTE: "-1",
      NIGHTLY_CONSOLIDATION_DAYS: "0",
    })).toMatchObject({ hour: 1, minute: 0, days: 14 });
    expect(loadNightlyConfig({
      NIGHTLY_CONSOLIDATION_ENABLED: "true",
      NIGHTLY_CONSOLIDATION_HOUR: "3",
      NIGHTLY_CONSOLIDATION_MINUTE: "30",
      NIGHTLY_CONSOLIDATION_DAYS: "7",
      NIGHTLY_SNAPSHOT_ENABLED: "true",
      NIGHTLY_QA_SNAPSHOT_ENABLED: "true",
    })).toEqual({
      enabled: true, hour: 3, minute: 30, days: 7,
      snapshotEnabled: true, qaSnapshotEnabled: true,
    });
  });

  it("当天未过取当天，已过取次日", () => {
    const before = new Date(2026, 10, 18, 1, 0, 0);
    expect(nextNightlyOccurrence(config, before))
      .toEqual(new Date(2026, 10, 18, 2, 0, 0));
    const after = new Date(2026, 10, 18, 2, 0, 1);
    expect(nextNightlyOccurrence(config, after))
      .toEqual(new Date(2026, 10, 19, 2, 0, 0));
  });
});

describe("夜间调度器", () => {
  it("默认关闭时不创建定时器", () => {
    vi.useFakeTimers();
    const stop = startNightlyConsolidationScheduler({
      createClient: clientOf,
      config: { ...config, enabled: false },
    });
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });

  it("到期执行一次，次日再次执行", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 18, 1, 59, 0));
    const client = clientOf();
    const stop = startNightlyConsolidationScheduler({ createClient: () => client, config });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.expirePatrolNotes).toHaveBeenCalledTimes(1);
    expect(client.fetchPatrolFeedback).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(client.expirePatrolNotes).toHaveBeenCalledTimes(2);
    stop();
  });

  it("失败后不抛出，并继续安排次日", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 18, 1, 59, 0));
    const client = clientOf();
    client.expirePatrolNotes = vi.fn().mockRejectedValue(new Error("down"));
    const stop = startNightlyConsolidationScheduler({ createClient: () => client, config });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.expirePatrolNotes).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(client.expirePatrolNotes).toHaveBeenCalledTimes(2);
    stop();
  });

  it("快照失败不阻塞离线整理", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 18, 0, 59, 0));
    const client = clientOf();
    const catalog = {
      slots: vi.fn().mockReturnValue({ active: { version: "v1", cards: 1 } }),
      stage: vi.fn().mockRejectedValue(new Error("snapshot down")),
      promote: vi.fn(),
    } as unknown as KnowledgeCatalog;
    const stop = startNightlyConsolidationScheduler({
      createClient: () => client,
      getCatalog: () => catalog,
      config: { ...config, hour: 1, snapshotEnabled: true },
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(catalog.stage).toHaveBeenCalledTimes(1);
    expect(client.expirePatrolNotes).toHaveBeenCalledTimes(1);
    stop();
  });

  it("停止后不再触发", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 18, 1, 59, 0));
    const client = clientOf();
    const stop = startNightlyConsolidationScheduler({ createClient: () => client, config });
    stop();
    await vi.advanceTimersByTimeAsync(48 * 60 * 60 * 1000);
    expect(client.expirePatrolNotes).not.toHaveBeenCalled();
  });

  it("快照切换写入最近指标", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 18, 0, 59, 0));
    const client = clientOf();
    const catalog = {
      slots: vi.fn().mockReturnValue({ active: { version: "v2", cards: 2 } }),
      stage: vi.fn().mockResolvedValue({ version: "v2", errors: [] }),
      promote: vi.fn(),
    } as unknown as KnowledgeCatalog;
    const stop = startNightlyConsolidationScheduler({
      createClient: () => client,
      getCatalog: () => catalog,
      syncQaSnapshot: async () => ({ version: "qa-v1", items: 3 }),
      config: { ...config, hour: 1, snapshotEnabled: true, qaSnapshotEnabled: true },
    });

    await vi.advanceTimersByTimeAsync(60_000);
    const metrics = readSnapshotMetrics();
    expect(metrics.knowledge).toMatchObject({
      action: "build", version: "v2", items: 2, errors: 0, ok: true,
    });
    expect(metrics.qa).toMatchObject({
      action: "promote", version: "qa-v1", items: 3, errors: 0, ok: true,
    });
    stop();
  });

  it("快照构建失败写入失败指标", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 18, 0, 59, 0));
    const client = clientOf();
    const catalog = {
      slots: vi.fn().mockReturnValue({ active: { version: "v1", cards: 1 } }),
      stage: vi.fn().mockRejectedValue(new Error("snapshot down")),
      promote: vi.fn(),
    } as unknown as KnowledgeCatalog;
    const stop = startNightlyConsolidationScheduler({
      createClient: () => client,
      getCatalog: () => catalog,
      config: { ...config, hour: 1, snapshotEnabled: true },
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(readSnapshotMetrics().knowledge).toMatchObject({
      action: "build", errors: 1, ok: false, reason: "snapshot down",
    });
    stop();
  });
});
