import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  // session-store 以可变对象模拟，保持仓库测试样板一致（本视图角色守卫由服务端完成）
  session: {
    status: "authed",
    me: null as unknown,
    loadMe: null as unknown,
  },
}));

vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: typeof mocks.session) => unknown) =>
    selector(mocks.session),
}));

import { TeacherModerationView } from "./TeacherModerationView";

describe("TeacherModerationView", () => {
  afterEach(() => {
    cleanup();
  });

  it("双栏骨架渲染：左栏队列空态 + 右栏工单详情占位卡（5/7 栅格）", () => {
    render(<TeacherModerationView />);

    expect(screen.getByText("工单接口随二期开放")).toBeTruthy();
    expect(screen.getByText("工单详情")).toBeTruthy();
    expect(screen.getByText("处置动作与来源内容预览随工单接口开放。")).toBeTruthy();

    const queueSection = screen.getByLabelText("工单队列");
    const detailSection = screen.getByLabelText("工单详情");
    expect(queueSection.className).toContain("lg:col-span-5");
    expect(detailSection.className).toContain("lg:col-span-7");
  });

  it("工单队列 Tab 切换：默认待处理，点击已处理后高亮", () => {
    render(<TeacherModerationView />);

    const pendingTab = screen.getByRole("tab", { name: "待处理" });
    const resolvedTab = screen.getByRole("tab", { name: "已处理" });
    expect(pendingTab.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(resolvedTab);
    expect(resolvedTab.getAttribute("aria-selected")).toBe("true");
    expect(pendingTab.getAttribute("aria-selected")).toBe("false");
  });

  it("课程筛选为空选项占位且不可用（不放假数据）", () => {
    render(<TeacherModerationView />);

    const select = screen.getByLabelText("课程") as HTMLSelectElement;
    expect(select.disabled).toBe(true);
    expect(select.options.length).toBe(1);
    expect(select.options[0]?.text).toBe("全部课程");
  });

  it("case_id 透传预留：落在容器 data 属性，自动选中随工单接口开放", () => {
    const { container } = render(<TeacherModerationView initialCaseId="42" />);

    const host = container.querySelector("[data-case-id]");
    expect(host).not.toBeNull();
    expect(host?.getAttribute("data-case-id")).toBe("42");
  });

  it("未带 case_id 时不渲染 data 属性", () => {
    const { container } = render(<TeacherModerationView />);

    expect(container.querySelector("[data-case-id]")).toBeNull();
  });
});
