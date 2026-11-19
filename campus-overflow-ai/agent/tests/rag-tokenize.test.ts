// RAG 分词：中文双字 n-gram、拉丁标识符与精确标识判定。
import { describe, expect, it } from "vitest";

import { isExactIdentifier, normalizeForSearch, tokenize } from "../src/knowledge/rag/tokenize.js";

describe("RAG 分词", () => {
  it("中文按双字切分且不跨标点", () => {
    expect(tokenize("线性代数")).toEqual(["线性", "性代", "代数"]);
    expect(tokenize("动态规划，最优子结构")).toEqual([
      "动态", "态规", "规划", "最优", "优子", "子结", "结构",
    ]);
  });

  it("保留拉丁单词、错误码与版本号", () => {
    const tokens = tokenize("HTTP 404 与 ERR_QUOTA_429，版本 v2.1");
    expect(tokens).toContain("http");
    expect(tokens).toContain("404");
    expect(tokens).toContain("err_quota_429");
    expect(tokens).toContain("v2.1");
  });

  it("全角字符归一化为半角", () => {
    expect(normalizeForSearch("ＡＢＣ１２３")).toBe("abc123");
  });

  it("精确标识符包含数字或分隔符且长度至少 3", () => {
    expect(isExactIdentifier("err_quota_429")).toBe(true);
    expect(isExactIdentifier("v2.1")).toBe(true);
    expect(isExactIdentifier("404")).toBe(true);
    expect(isExactIdentifier("http")).toBe(false);
    expect(isExactIdentifier("线性")).toBe(false);
  });
});
