import { describe, expect, it, vi } from "vitest";
import { createInternalClient } from "../src/internal-client";
import { aggregateReport, WeeklyAnalysisSchema } from "../src/scheduler/weekly-report";
import { asTraceId } from "../src/types";

const tag = (id: number, name = `主题${id}`) => ({ id, name, type: "tech" });
const question = (id: number, tags = [tag(7, "并发")]) => ({
  id, title: "线程问题", body: "学习疑问", tags, created_at: "2026-10-25T00:00:00Z",
});
const analysis = (focus: unknown[] = []) => WeeklyAnalysisSchema.parse({
  summary: "本期教学分析。", mappings: [], uncovered_suggestions: [], tag_focus: focus,
});

describe("周报高频标签与教学侧重点", () => {
  it("真实 HTTP 解码保留后端标签，旧响应无 tags 时为空", async () => {
    const old = { id: 3, title: "无标签问题", body: "正文", created_at: "2026-10-25T00:00:00Z" };
    const fetchImpl = vi.fn(async () => Response.json({ code: 200, data: {
      items: [question(11), old], total: 2,
    }, message: "ok" }));
    const client = createInternalClient({ baseUrl: "http://backend.test", token: "", fetchImpl });
    const result = await client.fetchRecentQuestions({ courseId: 7, days: 7 }, asTraceId("tag-focus"));
    expect(result[0]).toMatchObject({ tags: [tag(7, "并发")] });
    expect(result[1]).toMatchObject({ tags: [] });
  });

  it("每个标签按不同问题去重计数，同题重复标签与重复行不能抬高次数", () => {
    const first = question(11, [tag(7, "并发"), tag(7, "并发"), tag(8, "同步")]);
    const report = aggregateReport(analysis(), [], [first, first,
      question(12, [tag(7, "并发"), tag(8, "同步")]), question(13, [tag(9, "低频")])]);
    expect(report.content).toContain("并发：2 个不同问题");
    expect(report.content).toContain("同步：2 个不同问题");
    expect(report.content).not.toContain("低频：");
    expect(report.content).toContain("问题 #11、#12");
    expect(report.question_count).toBe(3);
  });

  it("有真实标签及问题依据才使用模型的共性说明和补讲建议", () => {
    const report = aggregateReport(analysis([{ tag_id: 7, question_ids: [11, 12],
      common_confusion: "学生反复混淆互斥与同步。", teaching_focus: "先用反例区分互斥与同步，再讲信号量例题。" }]),
    [], [question(11), question(12)]);
    expect(report.content).toContain("高频提问标签与教学侧重点");
    expect(report.content).toContain("共性疑问：学生反复混淆互斥与同步。");
    expect(report.content).toContain("教学侧重点：先用反例区分互斥与同步，再讲信号量例题。");
    expect(report.content).toContain("本期纳入分析的 2 条不同问题");
  });

  it("伪造标签或不属于标签的问题引用不能形成教学结论", () => {
    const report = aggregateReport(analysis([
      { tag_id: 99, question_ids: [11], common_confusion: "伪造主题", teaching_focus: "伪造建议" },
      { tag_id: 7, question_ids: [11, 999], common_confusion: "伪造引用", teaching_focus: "不可采用" },
    ]), [], [question(11), question(12)]);
    expect(report.content).toContain("并发：2 个不同问题");
    expect(report.content).not.toMatch(/伪造主题|伪造建议|伪造引用|不可采用/);
    expect(report.content).toContain("建议复看相关问题");
  });

  it("无高频或未标记标签时如实说明，不虚构教学薄弱点", () => {
    const report = aggregateReport(analysis(), [], [question(11, []), question(12, [tag(7)])]);
    expect(report.content).toContain("未发现至少关联 2 条不同问题的标签");
    expect(report.content).toContain("未标记标签的问题不参与本节统计");
    expect(report.content).not.toContain("共性疑问：");
  });

  it("按不同问题数降序、标签 ID 升序，正文最多展示前 10 项", () => {
    const tags = Array.from({ length: 12 }, (_, i) => tag(i + 1));
    const report = aggregateReport(analysis(), [], [question(11, tags), question(12, tags), question(13, [tag(12)])]);
    expect(report.content.indexOf("主题12：3")).toBeLessThan(report.content.indexOf("主题1：2"));
    expect(report.content).not.toContain("主题11：");
    expect(report.content).toContain("最多展示前 10 项");
  });
});
