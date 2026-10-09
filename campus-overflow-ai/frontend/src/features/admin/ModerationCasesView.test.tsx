import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ModerationCasesView } from "./ModerationCasesView";

describe("ModerationCasesView", () => {
  afterEach(() => {
    cleanup();
  });

  it("骨架渲染：类型/来源筛选占位 + 工单表头 + 空态，分页不渲染", () => {
    render(<ModerationCasesView />);

    // governance 501：空态说明接口未开放
    expect(screen.getByText("工单接口随二期开放")).toBeTruthy();

    // 工单表骨架：仅表头
    const table = screen.getByRole("table");
    for (const header of ["编号", "类型", "课程", "提交方", "状态", "时间", "操作"]) {
      expect(within(table).getByRole("columnheader", { name: header })).toBeTruthy();
    }

    // 类型/来源 Select 占位渲染且不可用（不放假数据交互）
    const typeSelect = screen.getByLabelText("类型") as HTMLSelectElement;
    expect(typeSelect.disabled).toBe(true);
    expect(typeSelect.options.length).toBe(3);
    expect(typeSelect.options[0]?.text).toBe("全部类型");
    const sourceSelect = screen.getByLabelText("来源") as HTMLSelectElement;
    expect(sourceSelect.disabled).toBe(true);
    expect(sourceSelect.options.length).toBe(3);
    expect(sourceSelect.options[2]?.text).toBe("Agent 发起");

    // governance 501：无数据可分页，分页组件不渲染
    expect(screen.queryByRole("navigation", { name: "分页" })).toBeNull();
  });

  it("状态 Tab 切换：默认待处理，点击已处理后高亮", () => {
    render(<ModerationCasesView />);

    const pendingTab = screen.getByRole("tab", { name: "待处理" });
    const resolvedTab = screen.getByRole("tab", { name: "已处理" });
    expect(pendingTab.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(resolvedTab);
    expect(resolvedTab.getAttribute("aria-selected")).toBe("true");
    expect(pendingTab.getAttribute("aria-selected")).toBe("false");
  });
});
