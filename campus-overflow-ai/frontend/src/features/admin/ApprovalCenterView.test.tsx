import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ApprovalCenterView } from "./ApprovalCenterView";

describe("ApprovalCenterView", () => {
  afterEach(() => {
    cleanup();
  });

  it("双栏骨架渲染：左栏队列空态 + 右栏详情占位（5/7 栅格）", () => {
    render(<ApprovalCenterView />);

    expect(screen.getByText("审批接口随二期开放")).toBeTruthy();
    expect(screen.getByText("工单详情")).toBeTruthy();

    const queueSection = screen.getByLabelText("审批队列");
    const detailSection = screen.getByLabelText("工单详情");
    expect(queueSection.className).toContain("lg:col-span-5");
    expect(detailSection.className).toContain("lg:col-span-7");
  });

  it("队列 Tab：默认全部，可在全部/待确认/已处置间切换", () => {
    render(<ApprovalCenterView />);

    const allTab = screen.getByRole("tab", { name: "全部" });
    expect(allTab.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "待确认" }));
    expect(screen.getByRole("tab", { name: "待确认" }).getAttribute("aria-selected")).toBe("true");
    expect(allTab.getAttribute("aria-selected")).toBe("false");

    fireEvent.click(screen.getByRole("tab", { name: "已处置" }));
    expect(screen.getByRole("tab", { name: "已处置" }).getAttribute("aria-selected")).toBe("true");
  });

  it("处置说明 Textarea 渲染但不可用，提示接口开放后可编辑", () => {
    render(<ApprovalCenterView />);

    const textarea = screen.getByLabelText("处置说明") as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
    expect(screen.getByText("接口开放后可编辑")).toBeTruthy();
  });

  it("接口 501 期间不渲染七动作按钮组（tasks.md 约束）", () => {
    render(<ApprovalCenterView />);

    for (const action of [
      "隐藏内容",
      "恢复内容",
      "警告用户",
      "封禁用户",
      "驳回工单",
      "标记误报",
      "转人工复核",
    ]) {
      expect(screen.queryByRole("button", { name: action })).toBeNull();
    }
  });
});
