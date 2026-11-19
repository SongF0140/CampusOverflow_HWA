import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createKnowledgeCatalog } from "../src/knowledge/catalog.js";

let root: string;
const tags = [{ id: 10, course_id: 1, source: "textbook" as const, active: true }];
const metadata = (patch: Record<string, unknown> = {}) => ({
  course_id: 1, tag_ids: [10], year: 2026,
  source: { kind: "textbook", id: "book-1" },
  body: { path: "books/book.md", bookmark: "definition" }, ...patch,
});
const card = (patch: Record<string, unknown> = {}, summary = "向量相似度的定义") =>
  `## 领域名称\n线性代数\n\n## 元数据\n\`\`\`json\n${JSON.stringify(metadata(patch))}\n\`\`\`\n\n## 摘要\n${summary}\n`;
const body = (text = "余弦衡量方向关系。") =>
  `<a id="definition"></a>\n${text}\n[返回卡片](../cards/cosine.md)\n<a id="next"></a>\n下一节不应读取`;
const put = async (patch: Record<string, unknown> = {}, text = body()) => {
  await writeFile(join(root, "cards/cosine.md"), card(patch));
  await writeFile(join(root, "books/book.md"), text);
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "co-catalog-"));
  await mkdir(join(root, "cards"));
  await mkdir(join(root, "books"));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("Markdown 知识目录", () => {
  it("目录、摘要、书签正文分层披露，且授权课程每次过滤", async () => {
    await put();
    const catalog = createKnowledgeCatalog({ root, trustedTags: () => tags });
    const result = await catalog.refresh();
    expect(result.added).toEqual(["cards/cosine.md"]);
    const index = catalog.list([1]);
    expect(index.cards).toEqual([{ id: "cards/cosine.md", domain: "线性代数", course_id: 1, tag_ids: [10] }]);
    expect(JSON.stringify(index)).not.toContain("向量相似度");
    expect(catalog.getCard("cards/cosine.md", [1])?.summary).toBe("向量相似度的定义");
    expect(catalog.getCard("cards/cosine.md", [2])).toBeUndefined();
    expect(catalog.list([]).cards).toEqual([]);
    const text = await catalog.getBody("cards/cosine.md", [1], index.version);
    expect(text?.content).toContain("余弦衡量方向关系");
    expect(text?.content).not.toContain("下一节不应读取");
    expect(await catalog.getBody("cards/cosine.md", [2], index.version)).toBeUndefined();
  });

  it("稳定内容不重解析、不发布新版本；摘要改变按哈希更新", async () => {
    await put();
    const updates: string[] = [];
    const catalog = createKnowledgeCatalog({ root, trustedTags: () => tags, onUpdate: v => { updates.push(v); } });
    const first = await catalog.refresh();
    const second = await catalog.refresh();
    expect(second.version).toBe(first.version);
    expect(second.parsed).toBe(0);
    expect(updates).toHaveLength(1);
    await writeFile(join(root, "cards/cosine.md"), card({}, "方向，而非向量长度"));
    const third = await catalog.refresh();
    expect(third.updated).toEqual(["cards/cosine.md"]);
    expect(third.version).not.toBe(first.version);
    expect(third.parsed).toBe(1);
  });

  it("正文改变立即拒绝旧内容，刷新后发布新版本", async () => {
    await put();
    const catalog = createKnowledgeCatalog({ root, trustedTags: () => tags });
    const first = await catalog.refresh();
    await writeFile(join(root, "books/book.md"), body("新的定义"));
    await expect(catalog.getBody("cards/cosine.md", [1], first.version)).rejects.toThrow("资料版本已变化");
    const changed = await catalog.refresh();
    expect(changed.updated).toEqual(["cards/cosine.md"]);
    expect((await catalog.getBody("cards/cosine.md", [1], changed.version))?.content).toContain("新的定义");
    await expect(catalog.getBody("cards/cosine.md", [1], first.version)).rejects.toThrow("目录版本已变化");
  });

  it("删除卡片或正文时移除旧入口", async () => {
    await put();
    const catalog = createKnowledgeCatalog({ root, trustedTags: () => tags });
    await catalog.refresh();
    await rm(join(root, "books/book.md"));
    const missing = await catalog.refresh();
    expect(missing.removed).toEqual(["cards/cosine.md"]);
    expect(catalog.list([1]).cards).toEqual([]);
    await put();
    await catalog.refresh();
    await rm(join(root, "cards/cosine.md"));
    expect((await catalog.refresh()).removed).toEqual(["cards/cosine.md"]);
  });

  it.each([
    [{ tag_ids: [999] }, "未知标签"],
    [{ course_id: 2 }, "跨课程标签"],
    [{ source: { kind: "model", id: "x" } }, "伪造来源"],
    [{ body: { path: "../outside.md", bookmark: "definition" } }, "路径逃逸"],
    [{ body: { path: "books/book.md", bookmark: "missing" } }, "缺失书签"],
  ])("拒绝%s（%s），错误不泄漏原文", async (patch) => {
    await put(patch);
    const catalog = createKnowledgeCatalog({ root, trustedTags: () => tags });
    const result = await catalog.refresh();
    expect(result.errors).toHaveLength(1);
    expect(catalog.list([1, 2]).cards).toEqual([]);
    expect(JSON.stringify(result.errors)).not.toContain("余弦衡量方向关系");
  });

  it("可信词表失效后即刻撤掉入口，即使文件内容没变化", async () => {
    await put();
    let active = true;
    const catalog = createKnowledgeCatalog({ root, trustedTags: () => tags.map(t => ({ ...t, active })) });
    await catalog.refresh();
    active = false;
    expect((await catalog.refresh()).removed).toEqual(["cards/cosine.md"]);
    expect(catalog.list([1]).cards).toEqual([]);
  });

  it("正文必须返回卡片，且卡片只能有三个板块", async () => {
    await put({}, '<a id="definition"></a>\n私人聊天不应被当资料');
    const catalog = createKnowledgeCatalog({ root, trustedTags: () => tags });
    expect((await catalog.refresh()).errors).toHaveLength(1);
    await put();
    await writeFile(join(root, "cards/cosine.md"), `${card()}\n## 私人聊天\n禁止进入目录`);
    expect((await catalog.refresh()).errors).toHaveLength(1);
    expect(catalog.list([1]).cards).toEqual([]);
  });

  it("根外正文符号链接不被读取", async () => {
    await put();
    const outside = await mkdtemp(join(tmpdir(), "co-outside-"));
    try {
      await writeFile(join(outside, "secret.md"), body("不得外泄"));
      await rm(join(root, "books"), { recursive: true });
      await symlink(outside, join(root, "books"), "junction");
      const catalog = createKnowledgeCatalog({ root, trustedTags: () => tags });
      expect((await catalog.refresh()).errors).toHaveLength(1);
      expect(catalog.list([1]).cards).toEqual([]);
    } finally { await rm(outside, { recursive: true, force: true }); }
  });

  it("刷新失败时清除旧入口，且不会改写资料", async () => {
    await put();
    const original = await readFile(join(root, "books/book.md"), "utf8");
    const catalog = createKnowledgeCatalog({ root, trustedTags: () => tags });
    await catalog.refresh();
    await writeFile(join(root, "cards/cosine.md"), "损坏格式");
    expect((await catalog.refresh()).removed).toEqual(["cards/cosine.md"]);
    expect(await readFile(join(root, "books/book.md"), "utf8")).toBe(original);
  });

  it("卡片在读取前被替换或词表撤销时，不沿用旧版本正文", async () => {
    await put();
    let active = true;
    const catalog = createKnowledgeCatalog({ root, trustedTags: () => tags.map(t => ({ ...t, active })) });
    const first = await catalog.refresh();
    await writeFile(join(root, "cards/cosine.md"), card({}, "新摘要"));
    await expect(catalog.getBody("cards/cosine.md", [1], first.version)).rejects.toThrow("资料版本已变化");
    const latest = await catalog.refresh();
    active = false;
    await expect(catalog.getBody("cards/cosine.md", [1], latest.version)).rejects.toThrow("资料版本已变化");
  });

  it("并发刷新复用同一轮；周期核对能发布变化，停止后不再自动更新", async () => {
    await put();
    let changed: (() => void) | undefined;
    const catalog = createKnowledgeCatalog({ root, trustedTags: () => tags, onUpdate: () => changed?.() });
    const first = catalog.refresh();
    expect(catalog.refresh()).toBe(first);
    await first;
    await catalog.start(1000);
    try {
      const published = new Promise<void>(resolve => { changed = resolve; });
      await writeFile(join(root, "cards/cosine.md"), card({}, "变化后的摘要"));
      await Promise.race([published, new Promise((_, reject) => setTimeout(() => reject(new Error("未刷新")), 3000))]);
      expect(catalog.getCard("cards/cosine.md", [1])?.summary).toBe("变化后的摘要");
      catalog.stop();
      catalog.stop();
      await writeFile(join(root, "cards/cosine.md"), card({}, "停止后变化"));
      expect(catalog.getCard("cards/cosine.md", [1])?.summary).toBe("变化后的摘要");
    } finally { catalog.stop(); }
  });
});
