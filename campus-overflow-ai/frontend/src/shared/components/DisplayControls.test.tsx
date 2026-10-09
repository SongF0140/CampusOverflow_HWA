import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Avatar, Card, FilterBar, StateBadge } from "./index";

afterEach(cleanup);

describe("Card", () => {
  it("渲染内容；isHoverable 时带 hover 描边变化", () => {
    const { container, rerender } = render(
      <Card>
        <p>卡片内容</p>
      </Card>,
    );
    expect(screen.getByText("卡片内容")).toBeTruthy();
    expect(container.firstElementChild?.className).not.toContain("hover:border-ink-subtle");

    rerender(
      <Card isHoverable>
        <p>卡片内容</p>
      </Card>,
    );
    expect(container.firstElementChild?.className).toContain("hover:border-ink-subtle");
  });
});

describe("Avatar", () => {
  it("无图时用昵称首字 fallback（panel 底 + ink 字）", () => {
    const { container } = render(<Avatar name="张三" />);
    expect(screen.getByText("张")).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });

  it("有图时渲染 img", () => {
    render(<Avatar name="张三" src="/avatar/zhang.png" />);
    const img = screen.getByRole("img", { name: "张三" });
    expect(img.getAttribute("src")).toBe("/avatar/zhang.png");
  });
});

describe("StateBadge", () => {
  it("问题/课程/账号状态输出中文文字，不只靠颜色", () => {
    render(
      <>
        <StateBadge tone="unresolved" />
        <StateBadge tone="resolved" />
        <StateBadge tone="banned" />
        <StateBadge tone="active" />
        <StateBadge tone="closed" />
        <StateBadge tone="hidden" />
      </>,
    );
    for (const text of ["未解决", "已解决", "已封禁", "进行中", "已结课", "已隐藏"]) {
      expect(screen.getByText(text)).toBeTruthy();
    }
  });

  it("支持自定义文案覆盖默认标签", () => {
    render(<StateBadge tone="resolved" label="已采纳" />);
    expect(screen.getByText("已采纳")).toBeTruthy();
  });
});

describe("FilterBar", () => {
  it("左主操作、右筛选两个 slot 都渲染且可交互", () => {
    const onAsk = vi.fn();
    const onFilter = vi.fn();
    render(
      <FilterBar
        actions={
          <button type="button" onClick={onAsk}>
            ＋ 提问
          </button>
        }
        filters={
          <button type="button" onClick={onFilter}>
            筛选
          </button>
        }
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "＋ 提问" }));
    fireEvent.click(screen.getByRole("button", { name: "筛选" }));
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onFilter).toHaveBeenCalledTimes(1);
  });
});
