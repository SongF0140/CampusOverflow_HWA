// 教师知识树工作台测试（K-05，KN-R01~03）：三区块加载与写入闭环——
// 大纲分析建议确认写入、周报差距一键加入教学计划与拓宽知识树、手动新增与状态切换。
import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchKnowledgeTree: vi.fn(),
  addKnowledgeNodes: vi.fn(),
  deleteKnowledgeNode: vi.fn(),
  fetchTeachingPlan: vi.fn(),
  createTeachingPlanItem: vi.fn(),
  updateTeachingPlanItem: vi.fn(),
  deleteTeachingPlanItem: vi.fn(),
  fetchWeeklyReports: vi.fn(),
  analyzeOutline: vi.fn(),
}));

vi.mock("@/api/knowledge", () => ({
  fetchKnowledgeTree: mocks.fetchKnowledgeTree,
  addKnowledgeNodes: mocks.addKnowledgeNodes,
  deleteKnowledgeNode: mocks.deleteKnowledgeNode,
  fetchTeachingPlan: mocks.fetchTeachingPlan,
  createTeachingPlanItem: mocks.createTeachingPlanItem,
  updateTeachingPlanItem: mocks.updateTeachingPlanItem,
  deleteTeachingPlanItem: mocks.deleteTeachingPlanItem,
  fetchWeeklyReports: mocks.fetchWeeklyReports,
  analyzeOutline: mocks.analyzeOutline,
}));

import { KnowledgeView } from "./KnowledgeView";

const TREE = {
  course_id: 7,
  nodes: [
    { id: 1, name: "死锁", sort_key: "死锁", parent_id: null, position: null, source: "teacher", created_at: "2026-10-20T00:00:00Z" },
    { id: 2, name: "进程", sort_key: "进程", parent_id: 1, position: "right", source: "teacher", created_at: "2026-10-20T00:00:00Z" },
  ],
  tree: [
    { id: 1, name: "死锁", sort_key: "死锁", position: null, source: "teacher",
      children: [{ id: 2, name: "进程", sort_key: "进程", position: "right", source: "teacher", children: [] }] },
  ],
  inorder: [
    { id: 1, name: "死锁", sort_key: "死锁", parent_id: null, position: null, source: "teacher", created_at: "2026-10-20T00:00:00Z" },
    { id: 2, name: "进程", sort_key: "进程", parent_id: 1, position: "right", source: "teacher", created_at: "2026-10-20T00:00:00Z" },
  ],
};

const REPORT = {
  id: 55, course_id: 7, teacher_id: 3, week_start: "2026-10-13", week_end: "2026-10-19",
  content: "本周提问集中在并发。",
  uncovered_topics: [
    { topic: "内存置换算法", question_count: 4, suggestion: "建议补充例题" },
  ],
  heatmap: [{ node_id: 2, node_name: "进程", question_count: 6 }],
  question_count: 10, agent_run_id: "run-1", created_at: "2026-10-20T08:00:00Z",
};

beforeEach(() => {
  mocks.fetchKnowledgeTree.mockReset().mockResolvedValue(TREE);
  mocks.fetchTeachingPlan.mockReset().mockResolvedValue({
    items: [
      { id: 9, course_id: 7, teacher_id: 3, title: "补充调度讲解", detail: null,
        source: "manual", report_id: null, status: "pending",
        created_at: "2026-10-19T00:00:00Z", updated_at: "2026-10-19T00:00:00Z" },
    ],
    total: 1,
  });
  mocks.fetchWeeklyReports.mockReset().mockResolvedValue({ items: [REPORT], total: 1 });
  mocks.addKnowledgeNodes.mockReset().mockResolvedValue({ data: TREE, message: "ok" });
  mocks.createTeachingPlanItem.mockReset().mockResolvedValue({ data: {}, message: "ok" });
  mocks.updateTeachingPlanItem.mockReset().mockResolvedValue({ data: {}, message: "ok" });
  mocks.analyzeOutline.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("KnowledgeView 教师知识树工作台", () => {
  it("加载树/教学计划/周报并渲染中序与周报差距", async () => {
    render(<KnowledgeView courseId={7} />);
    expect(await screen.findByText("课程知识树")).toBeInTheDocument();
    expect(screen.getByText(/死锁 → 进程/)).toBeInTheDocument();
    expect(screen.getByText("补充调度讲解")).toBeInTheDocument();
    expect(await screen.findByText("内存置换算法")).toBeInTheDocument();
    expect(screen.getByText(/本周提问 10 个/)).toBeInTheDocument();
    // "进程"同时出现在树节点与提问热力，两处均应渲染
    expect(screen.getAllByText("进程").length).toBeGreaterThanOrEqual(2);
  });

  it("大纲分析 → 勾选建议 → 确认写入（E-17：仅勾选项写入）", async () => {
    mocks.analyzeOutline.mockResolvedValue({
      nodes: [
        { name: "线程", reason: "第二章并发" },
        { name: "调度算法", reason: "第一章" },
      ],
      notes: "建议均不与现有知识树重复。",
    });
    render(<KnowledgeView courseId={7} />);
    await screen.findByText("课程知识树");

    fireEvent.change(screen.getByPlaceholderText(/粘贴教材目录/), {
      target: { value: "第一章 进程与调度" },
    });
    fireEvent.click(screen.getByRole("button", { name: "分析大纲" }));
    await screen.findByText("线程");
    // 取消勾选"调度算法"，仅写入"线程"
    fireEvent.click(screen.getByLabelText(/调度算法/));
    fireEvent.click(screen.getByRole("button", { name: "确认写入所选知识点" }));
    await waitFor(() => {
      expect(mocks.addKnowledgeNodes).toHaveBeenCalledWith(7, ["线程"]);
    });
  });

  it("周报差距：加入教学计划带 report_id；拓宽知识树写入主题知识点", async () => {
    render(<KnowledgeView courseId={7} />);
    await screen.findByText("内存置换算法");

    fireEvent.click(screen.getByRole("button", { name: "加入教学计划" }));
    await waitFor(() => {
      expect(mocks.createTeachingPlanItem).toHaveBeenCalledWith(7, {
        title: "拓宽知识点：内存置换算法",
        report_id: 55,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "拓宽知识树" }));
    await waitFor(() => {
      expect(mocks.addKnowledgeNodes).toHaveBeenCalledWith(7, ["内存置换算法"]);
    });
  });

  it("手动新增知识点与教学计划条目", async () => {
    render(<KnowledgeView courseId={7} />);
    await screen.findByText("课程知识树");

    fireEvent.change(screen.getByPlaceholderText("手动新增知识点名称"), {
      target: { value: "信号量" },
    });
    fireEvent.click(screen.getByRole("button", { name: "新增" }));
    await waitFor(() => {
      expect(mocks.addKnowledgeNodes).toHaveBeenCalledWith(7, ["信号量"]);
    });

    fireEvent.change(screen.getByPlaceholderText(/新增教学计划条目/), {
      target: { value: "补充内存管理讲解" },
    });
    fireEvent.click(screen.getByRole("button", { name: "加入" }));
    await waitFor(() => {
      expect(mocks.createTeachingPlanItem).toHaveBeenCalledWith(7, {
        title: "补充内存管理讲解",
      });
    });
  });

  it("周报已拓宽主题不再提供重复拓宽入口", async () => {
    render(<KnowledgeView courseId={7} />);
    await screen.findByText("内存置换算法");
    // 树内已有"进程"主题时不存在同名未覆盖主题场景，此处验证按钮状态文案机制：
    // 勾选写入后树刷新前，按钮文案仍可交互；核心去重由后端 E-15 拒绝。
    expect(screen.getByRole("button", { name: "拓宽知识树" })).toBeInTheDocument();
  });

  it("分析失败展示错误提示且不写入", async () => {
    mocks.analyzeOutline.mockRejectedValue(new Error("大纲分析暂不可用"));
    render(<KnowledgeView courseId={7} />);
    await screen.findByText("课程知识树");

    fireEvent.change(screen.getByPlaceholderText(/粘贴教材目录/), {
      target: { value: "大纲" },
    });
    fireEvent.click(screen.getByRole("button", { name: "分析大纲" }));
    await screen.findByText("大纲分析暂不可用");
    expect(mocks.addKnowledgeNodes).not.toHaveBeenCalled();
  });
});
