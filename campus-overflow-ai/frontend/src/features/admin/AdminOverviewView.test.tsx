import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AdminOverviewView } from "./AdminOverviewView";

// 治理总览为纯静态视图（无接口调用），无需 mock
describe("AdminOverviewView", () => {
  afterEach(() => {
    cleanup();
  });

  it("指标卡一行×5：数值以 '-' 占位并导航到对应子页", () => {
    render(<AdminOverviewView />);

    // TODO(接口差异)：后端无治理聚合指标接口，五个数字均为占位符
    expect(screen.getAllByText("-").length).toBe(5);

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

  it("快捷入口卡：四个入口可点导航，Agent 运行 disabled 带'二期'文案", () => {
    render(<AdminOverviewView />);

    expect(screen.getByRole("link", { name: /用户治理/ }).getAttribute("href")).toBe("/admin/users");
    expect(screen.getByRole("link", { name: /课程治理/ }).getAttribute("href")).toBe("/admin/courses");
    expect(screen.getByRole("link", { name: /审核队列/ }).getAttribute("href")).toBe(
      "/admin/moderation/cases",
    );
    expect(screen.getByRole("link", { name: /审批中心/ }).getAttribute("href")).toBe(
      "/admin/moderation/approvals",
    );

    // Agent 入口置灰（二期），不可点击
    const agentEntry = screen.getByRole("button", { name: /Agent 运行/ }) as HTMLButtonElement;
    expect(agentEntry.disabled).toBe(true);
    expect(agentEntry.textContent).toContain("二期");
  });

  it("右侧最近事件流：后端无审计事件读接口，渲染空态占位", () => {
    render(<AdminOverviewView />);

    expect(screen.getByText("暂无治理事件")).toBeTruthy();
  });
});
