import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCourse: vi.fn(),
  updateCourse: vi.fn(),
  onSaved: vi.fn(),
  onCancel: vi.fn(),
}));

vi.mock("@/api/courses", () => ({
  createCourse: mocks.createCourse,
  updateCourse: mocks.updateCourse,
}));

import { ApiError } from "@/api/client";

import { CourseForm } from "./CourseForm";

const COURSE = {
  id: 7,
  name: "数据结构",
  code: "CS101",
  teacher_name: "teacher01",
  member_count: 3,
  question_count: 1,
  created_at: "",
};

beforeEach(() => {
  mocks.createCourse.mockReset();
  mocks.updateCourse.mockReset();
  mocks.onSaved.mockReset();
  mocks.onCancel.mockReset();
});

afterEach(cleanup);

describe("CourseForm", () => {
  it("新建课程：提交后端接受的字段并回调 onSaved", async () => {
    mocks.createCourse.mockResolvedValue({ data: { id: 9 }, message: "课程创建成功" });
    render(<CourseForm onSaved={mocks.onSaved} onCancel={mocks.onCancel} />);

    fireEvent.change(screen.getByPlaceholderText("例如：数据结构"), {
      target: { value: "操作系统" },
    });
    fireEvent.change(screen.getByPlaceholderText("例如：CS101"), { target: { value: "CS102" } });
    fireEvent.change(screen.getByPlaceholderText("一句话介绍这门课程"), {
      target: { value: "进程与内存管理" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建课程" }));

    await waitFor(() =>
      expect(mocks.createCourse).toHaveBeenCalledWith({
        name: "操作系统",
        code: "CS102",
        description: "进程与内存管理",
        semester: undefined,
      }),
    );
    await waitFor(() => expect(mocks.onSaved).toHaveBeenCalled());
  });

  it("新建课程：编码重复时展示后端中文提示，且不回调成功", async () => {
    mocks.createCourse.mockRejectedValue(new ApiError(400, "课程编码已存在"));
    render(<CourseForm onSaved={mocks.onSaved} onCancel={mocks.onCancel} />);

    fireEvent.change(screen.getByPlaceholderText("例如：数据结构"), {
      target: { value: "操作系统" },
    });
    fireEvent.change(screen.getByPlaceholderText("例如：CS101"), { target: { value: "CS101" } });
    fireEvent.click(screen.getByRole("button", { name: "创建课程" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("课程编码已存在"));
    expect(mocks.onSaved).not.toHaveBeenCalled();
  });

  it("新建课程：课程名为空时给出中文提示且不发请求", async () => {
    render(<CourseForm onSaved={mocks.onSaved} onCancel={mocks.onCancel} />);

    fireEvent.click(screen.getByRole("button", { name: "创建课程" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("课程名不能为空"));
    expect(mocks.createCourse).not.toHaveBeenCalled();
  });

  it("编辑课程：编码只读，提交只带可改字段", async () => {
    mocks.updateCourse.mockResolvedValue({ data: { id: 7 }, message: "课程更新成功" });
    render(<CourseForm course={COURSE} onSaved={mocks.onSaved} onCancel={mocks.onCancel} />);

    // 编码是课程标识，编辑态不提供输入框
    expect(screen.queryByPlaceholderText("例如：CS101")).toBeNull();
    expect(screen.getByText(/编码是课程标识，不可修改/)).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("例如：数据结构"), {
      target: { value: "数据结构（改）" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() =>
      expect(mocks.updateCourse).toHaveBeenCalledWith(7, {
        name: "数据结构（改）",
        description: undefined,
        semester: undefined,
      }),
    );
  });
});
