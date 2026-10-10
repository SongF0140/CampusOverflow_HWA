import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AppealsAdminView } from "./AppealsAdminView";

describe("AppealsAdminView", () => {
  afterEach(() => {
    cleanup();
  });

  it("骨架渲染：状态筛选占位 + 申诉表头 + 空态", () => {
    render(<AppealsAdminView />);

    expect(screen.getByText("申诉接口随二期开放")).toBeTruthy();

    const table = screen.getByRole("table");
    for (const header of ["用户", "封禁原因", "申诉理由", "提交时间", "状态", "操作"]) {
      expect(within(table).getByRole("columnheader", { name: header })).toBeTruthy();
    }

    // 状态 Select 占位渲染且不可用
    const statusSelect = screen.getByLabelText("状态") as HTMLSelectElement;
    expect(statusSelect.disabled).toBe(true);
    expect(statusSelect.options.length).toBe(3);
    expect(statusSelect.options[1]?.text).toBe("待处理");
  });

  it("无数据行：维持/撤销操作按钮不渲染（操作随接口开放后渲染）", () => {
    render(<AppealsAdminView />);

    expect(screen.queryByRole("button", { name: "维持" })).toBeNull();
    expect(screen.queryByRole("button", { name: "撤销" })).toBeNull();
  });
});
