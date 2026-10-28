import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listUsers: vi.fn(),
  listQuestions: vi.fn(),
  fetchModerationCases: vi.fn(),
  fetchAppeals: vi.fn(),
}));

vi.mock("@/api/users", () => ({ listUsers: mocks.listUsers }));
vi.mock("@/api/questions", () => ({ listQuestions: mocks.listQuestions }));
vi.mock("@/api/governance", () => ({
  fetchModerationCases: mocks.fetchModerationCases,
  fetchAppeals: mocks.fetchAppeals,
}));

import { AdminOverviewView } from "./AdminOverviewView";

beforeEach(() => {
  mocks.listUsers.mockResolvedValue({ items: [], total: 42, page: 1, page_size: 1 });
  mocks.listQuestions.mockResolvedValue({ items: [], total: 3, page: 1, page_size: 1 });
  mocks.fetchModerationCases.mockImplementation(
    async (params: { status?: string }) => ({
      items: [],
      total: params.status === "pending" ? 5 : 2,
      page: 1,
      page_size: 1,
    }),
  );
  mocks.fetchAppeals.mockResolvedValue({ items: [], total: 1, page: 1, page_size: 1 });
});

// 治理总览：指标来自真实列表接口的 total
describe("AdminOverviewView", () => {
  afterEach(() => {
    cleanup();
  });

  it("指标卡一行×5：数值来自真实接口 total 并导航到对应子页", async () => {
    render(<AdminOverviewView />);

    await waitFor(() => {
      expect(screen.getByText("42")).toBeTruthy();
      expect(screen.getByText("3")).toBeTruthy();
      expect(screen.getByText("5")).toBeTruthy();
      expect(screen.getByText("2")).toBeTruthy();
      expect(screen.getByText("1")).toBeTruthy();
    });

    const metricExpectations: Array<[RegExp, string]> = [
      [/注册用户/, "/admin/users"],
      [/今日新增问题/, "/"],
      [/待审工单/, "/admin/moderation/cases"],
      [/待审批/, "/admin/moderation/approvals"],
      [/申诉待处理/, "/admin/moderation/appeals"],
    ];
    for (const [name, href] of metricExpectations) {
      expect(screen.getByRole("link", { name }).getAttribute("href")).toBe(href);
    }
  });

  it("单个指标接口失败：该卡显示 '-'，其余照常", async () => {
    mocks.listUsers.mockRejectedValue(new Error("boom"));
    render(<AdminOverviewView />);

    await waitFor(() => expect(screen.getByText("5")).toBeTruthy());
    expect(screen.getAllByText("-")).toHaveLength(1);
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("快捷入口卡：五个入口均可点导航（含 Agent 运行）", () => {
    render(<AdminOverviewView />);

    expect(screen.getByRole("link", { name: /用户治理/ }).getAttribute("href")).toBe("/admin/users");
    expect(screen.getByRole("link", { name: /课程治理/ }).getAttribute("href")).toBe("/admin/courses");
    expect(screen.getByRole("link", { name: /审核队列/ }).getAttribute("href")).toBe(
      "/admin/moderation/cases",
    );
    expect(screen.getByRole("link", { name: /审批中心/ }).getAttribute("href")).toBe(
      "/admin/moderation/approvals",
    );

    expect(screen.getByRole("link", { name: /Agent 运行/ }).getAttribute("href")).toBe(
      "/admin/agent/runs",
    );
  });

  it("右侧最近事件流：后端无审计事件读接口，渲染空态占位", () => {
    render(<AdminOverviewView />);

    expect(screen.getByText("暂无治理事件")).toBeTruthy();
  });
});
