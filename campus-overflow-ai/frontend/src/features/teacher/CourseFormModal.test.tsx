import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CourseFormModal } from "./CourseFormModal";

afterEach(cleanup);

function openModal(overrides: Record<string, unknown> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
    <CourseFormModal
      open
      title="新建课程"
      onSubmit={onSubmit}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onSubmit, onClose };
}

describe("CourseFormModal", () => {
  it("新建模式渲染空表单，必填校验拦截空提交", () => {
    const { onSubmit } = openModal();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(screen.getByText("课程名不能为空")).toBeTruthy();
    expect(screen.getByText("课程编码不能为空")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("填写后提交：name/code 去空格，空简介/未选学期归一为 null", () => {
    const { onSubmit } = openModal();

    fireEvent.change(screen.getByLabelText("课程名"), { target: { value: " 计算机网络 " } });
    fireEvent.change(screen.getByLabelText("课程编码"), { target: { value: " CS301 " } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "计算机网络",
      code: "CS301",
      description: null,
      semester: null,
    });
  });

  it("编辑模式（lockCode）预填并禁用课程编码，提交值仍完整回传", () => {
    const { onSubmit } = openModal({
      title: "编辑课程",
      lockCode: true,
      initial: { name: "操作系统", code: "CS201", description: null, semester: "2026秋" },
    });

    const codeInput = screen.getByLabelText("课程编码") as HTMLInputElement;
    expect(codeInput.value).toBe("CS201");
    expect(codeInput.disabled).toBe(true);
    expect(screen.getByText("课程编码创建后不可修改")).toBeTruthy();

    expect((screen.getByLabelText("课程名") as HTMLInputElement).value).toBe("操作系统");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "操作系统",
      code: "CS201",
      description: null,
      semester: "2026秋",
    });
  });

  it("提交中禁用取消按钮并显示保存中，submitError 行内展示", () => {
    openModal({ submitting: true, submitError: "课程编码已存在" });

    expect(screen.getByRole("button", { name: /保存中/ })).toBeTruthy();
    expect(screen.getByText("课程编码已存在")).toBeTruthy();
  });

  it("取消按钮触发 onClose", () => {
    const { onClose } = openModal();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
