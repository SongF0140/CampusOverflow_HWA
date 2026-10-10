import { describe, expect, it } from "vitest";

import { timeAgo } from "./timeAgo";

const NOW = Date.parse("2026-10-06T12:00:00+08:00");

function isoBefore(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe("timeAgo", () => {
  it("1 分钟内显示「刚刚」", () => {
    expect(timeAgo(isoBefore(0), NOW)).toBe("刚刚");
    expect(timeAgo(isoBefore(59_000), NOW)).toBe("刚刚");
  });

  it("1 小时内显示「N 分钟前」", () => {
    expect(timeAgo(isoBefore(60_000), NOW)).toBe("1 分钟前");
    expect(timeAgo(isoBefore(59 * 60_000), NOW)).toBe("59 分钟前");
  });

  it("24 小时内显示「N 小时前」（如 3 小时前）", () => {
    expect(timeAgo(isoBefore(60 * 60_000), NOW)).toBe("1 小时前");
    expect(timeAgo(isoBefore(3 * 60 * 60_000), NOW)).toBe("3 小时前");
    expect(timeAgo(isoBefore(23 * 60 * 60_000), NOW)).toBe("23 小时前");
  });

  it("30 天内显示「N 天前」", () => {
    expect(timeAgo(isoBefore(24 * 60 * 60_000), NOW)).toBe("1 天前");
    expect(timeAgo(isoBefore(29 * 24 * 60 * 60_000), NOW)).toBe("29 天前");
  });

  it("30 天及以上退化为中文绝对日期", () => {
    expect(timeAgo(isoBefore(30 * 24 * 60 * 60_000), NOW)).toBe("2026年9月6日");
    expect(timeAgo("2026-01-15T08:00:00+08:00", NOW)).toBe("2026年1月15日");
  });

  it("非法时间串返回空字符串", () => {
    expect(timeAgo("不是时间", NOW)).toBe("");
  });
});
