// 夜间双槽：stage 不影响活跃目录，promote 切换并保留旧槽，rollback 可回退。
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createKnowledgeCatalog } from "../src/knowledge/catalog.js";
import { runNightlySnapshot } from "../src/scheduler/nightly-snapshot.js";

let root: string;
const tags = [{ id: 10, course_id: 1, source: "textbook" as const, active: true }];

const write = async (summary: string) => {
  const metadata = {
    course_id: 1, tag_ids: [10], year: 2026,
    source: { kind: "textbook", id: "book-1" },
    body: { path: "books/book.md", bookmark: "definition" },
  };
  await writeFile(join(root, "cards/cosine.md"),
    `## 领域名称\n线性代数\n\n## 元数据\n\`\`\`json\n${JSON.stringify(metadata)}\n\`\`\`\n\n## 摘要\n${summary}\n`);
  await writeFile(join(root, "books/book.md"),
    `<a id="definition"></a>\n余弦衡量方向关系。\n[返回卡片](../cards/cosine.md)\n<a id="next"></a>\n下一节`);
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "co-slots-"));
  await mkdir(join(root, "cards"));
  await mkdir(join(root, "books"));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("知识目录双槽", () => {
  it("stage 不改活跃目录，promote 切换并保留旧槽，rollback 恢复", async () => {
    await write("旧摘要");
    const catalog = createKnowledgeCatalog({ root, trustedTags: () => tags });
    await catalog.refresh();
    const oldVersion = catalog.list([1]).version;

    await write("新摘要");
    const staged = await catalog.stage();
    expect(staged.errors).toEqual([]);
    expect(catalog.getCard("cards/cosine.md", [1])?.summary).toBe("旧摘要");
    expect(catalog.slots().staging?.version).toBe(staged.version);

    const promoted = catalog.promote();
    expect(promoted.active.version).toBe(staged.version);
    expect(catalog.getCard("cards/cosine.md", [1])?.summary).toBe("新摘要");
    expect(promoted.previous?.version).toBe(oldVersion);

    const rolled = catalog.rollback();
    expect(rolled.active.version).toBe(oldVersion);
    expect(catalog.getCard("cards/cosine.md", [1])?.summary).toBe("旧摘要");
  });

  it("解析错误时拒绝切换，活跃目录保持不变", async () => {
    await write("旧摘要");
    const catalog = createKnowledgeCatalog({ root, trustedTags: () => tags });
    await catalog.refresh();
    const before = catalog.list([1]).version;

    await writeFile(join(root, "cards/broken.md"), "缺少必需板块");
    await expect(runNightlySnapshot(catalog)).rejects.toThrow("snapshot_validation_failed");
    expect(catalog.list([1]).version).toBe(before);
    expect(catalog.slots().staging).not.toBeNull();
  });

  it("版本未变化时不重复切换", async () => {
    await write("同一摘要");
    const catalog = createKnowledgeCatalog({ root, trustedTags: () => tags });
    await catalog.refresh();
    const outcome = await runNightlySnapshot(catalog);
    expect(outcome.promoted).toBe(false);
    expect(catalog.slots().previous).toBeNull();
  });

  it("旧槽超过保留期后不可回退", async () => {
    await write("旧摘要");
    const catalog = createKnowledgeCatalog({
      root, trustedTags: () => tags, previousTtlMs: -1,
    });
    await catalog.refresh();
    await write("新摘要");
    await catalog.stage();
    catalog.promote();
    expect(() => catalog.rollback()).toThrow("旧快照已过期");
  });

  it("旧槽到期后访问槽信息即清理", async () => {
    await write("旧摘要");
    const catalog = createKnowledgeCatalog({
      root, trustedTags: () => tags, previousTtlMs: -1,
    });
    await catalog.refresh();
    await write("新摘要");
    await catalog.stage();
    catalog.promote();
    expect(catalog.slots().previous).toBeNull();
  });
});
