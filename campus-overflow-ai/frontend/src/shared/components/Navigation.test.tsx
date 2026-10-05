import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Pagination, TabNav } from "./index";

afterEach(cleanup);

describe("TabNav", () => {
  const tabs = [
    { key: "latest", label: "最新" },
    { key: "hot", label: "热门" },
    { key: "unresolved", label: "未解决" },
  ];

  it("受控切换：点击回调 key，当前项标记选中", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TabNav tabs={tabs} active="latest" onChange={onChange} />);

    fireEvent.click(screen.getByRole("tab", { name: "热门" }));
    expect(onChange).toHaveBeenCalledWith("hot");

    rerender(<TabNav tabs={tabs} active="hot" onChange={onChange} />);
    expect(screen.getByRole("tab", { name: "热门" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "最新" }).getAttribute("aria-selected")).toBe("false");
  });
});

describe("Pagination", () => {
  it("小页数全量渲染页码，点击页码回调", () => {
    const onChange = vi.fn();
    render(<Pagination page={2} pageSize={10} total={35} onChange={onChange} />);
    expect(screen.queryByText("…")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "3" }));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("超过 7 页折叠省略号，首尾页恒在且只保留当前页±1", () => {
    const onChange = vi.fn();
    // 共 10 页、当前第 5 页：1 … 4 5 6 … 10
    render(<Pagination page={5} pageSize={10} total={100} onChange={onChange} />);
    expect(screen.getAllByText("…").length).toBe(2);
    for (const label of ["1", "4", "6", "10"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: "2" })).toBeNull();
    expect(screen.queryByRole("button", { name: "9" })).toBeNull();
  });

  it("当前页标记 aria-current 且不可点，上一页/下一页回调翻页", () => {
    const onChange = vi.fn();
    render(<Pagination page={3} pageSize={10} total={100} onChange={onChange} />);
    const current = screen.getByRole("button", { name: "3" }) as HTMLButtonElement;
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(onChange).toHaveBeenCalledWith(4);
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it("首页禁用上一页，末页禁用下一页", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Pagination page={1} pageSize={10} total={100} onChange={onChange} />,
    );
    expect(
      (screen.getByRole("button", { name: "上一页" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    rerender(<Pagination page={10} pageSize={10} total={100} onChange={onChange} />);
    expect((screen.getByRole("button", { name: "下一页" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
