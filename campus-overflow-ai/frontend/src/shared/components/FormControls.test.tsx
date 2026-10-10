import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Input, Select, Textarea } from "./index";

afterEach(cleanup);

describe("Input", () => {
  it("label 与输入框关联，输入触发 onChange", () => {
    const onChange = vi.fn();
    render(<Input label="邮箱" onChange={onChange} />);
    const input = screen.getByLabelText("邮箱") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "a@b.c" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("error 显示行内红字并标记 aria-invalid，且优先于 hint", () => {
    render(<Input label="账号" error="请输入账号" hint="支持邮箱或用户名" />);
    const input = screen.getByLabelText("账号") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("请输入账号")).toBeTruthy();
    expect(screen.queryByText("支持邮箱或用户名")).toBeNull();
  });

  it("无 error 时显示 hint", () => {
    render(<Input label="账号" hint="支持邮箱或用户名" />);
    expect(screen.getByText("支持邮箱或用户名")).toBeTruthy();
  });
});

describe("Textarea", () => {
  it("label 关联；默认 6 行", () => {
    render(<Textarea label="正文" />);
    const area = screen.getByLabelText("正文") as HTMLTextAreaElement;
    expect(area.getAttribute("rows")).toBe("6");
  });

  it("error 显示行内提示", () => {
    render(<Textarea label="正文" error="正文不能为空" />);
    expect(screen.getByText("正文不能为空")).toBeTruthy();
    expect((screen.getByLabelText("正文") as HTMLTextAreaElement).getAttribute("aria-invalid")).toBe(
      "true",
    );
  });
});

describe("Select", () => {
  it("options 渲染成 option，切换触发 onChange", () => {
    const onChange = vi.fn();
    render(
      <Select
        label="课程"
        options={[
          { value: "1", label: "数据结构" },
          { value: "2", label: "算法设计" },
        ]}
        onChange={onChange}
      />,
    );
    const select = screen.getByLabelText("课程") as HTMLSelectElement;
    expect(select.options.length).toBe(2);
    fireEvent.change(select, { target: { value: "2" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("支持 children 自定义 option，error 行内提示", () => {
    render(
      <Select label="学期" error="请选择学期">
        <option value="">请选择</option>
        <option value="2026-1">2026 秋</option>
      </Select>,
    );
    expect(screen.getByRole("option", { name: "2026 秋" })).toBeTruthy();
    expect(screen.getByText("请选择学期")).toBeTruthy();
  });
});
