import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  createQuestion: vi.fn(),
  fetchCourses: vi.fn(),
  fetchTags: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("@/api/courses", () => ({ fetchCourses: mocks.fetchCourses }));
vi.mock("@/api/tags", () => ({ fetchTags: mocks.fetchTags }));
vi.mock("@/api/questions", () => ({ createQuestion: mocks.createQuestion }));

import { PublishForm } from "./PublishForm";

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.createQuestion.mockReset();
  mocks.fetchCourses.mockResolvedValue({
    items: [
      {
        id: 1,
        name: "数据结构",
        code: "CS101",
        teacher_name: "teacher01",
        member_count: 1,
        question_count: 0,
        created_at: "",
      },
    ],
    total: 1,
    page: 1,
    page_size: 50,
  });
  mocks.fetchTags.mockResolvedValue({
    items: [{ id: 11, name: "红黑树", type: "tech", question_count: 0 }],
  });
});

afterEach(cleanup);

async function fillForm() {
  await screen.findByRole("option", { name: /数据结构/ });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } });
  fireEvent.change(screen.getByPlaceholderText("一句话说清你的问题"), {
    target: { value: "红黑树删除为什么要分四种情况？" },
  });
  fireEvent.change(screen.getByPlaceholderText(/支持 Markdown/), {
    target: { value: "正文内容" },
  });
}

describe("PublishForm", () => {
  it("未选课程时不发请求，给出中文提示", async () => {
    render(<PublishForm />);
    await fillForm();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: "发布问题" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("请选择课程"));
    expect(mocks.createQuestion).not.toHaveBeenCalled();
  });

  it("填写完整后提交，成功后跳转问题详情", async () => {
    mocks.createQuestion.mockResolvedValue({
      data: { id: 42, title: "标题", status: "published", created_at: "" },
      message: "发布成功",
    });
    render(<PublishForm />);
    await fillForm();

    fireEvent.click(screen.getByRole("button", { name: "发布问题" }));

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/questions/42"));
    expect(mocks.createQuestion).toHaveBeenCalledWith({
      title: "红黑树删除为什么要分四种情况？",
      body: "正文内容",
      course_id: 1,
      tag_ids: null,
    });
  });

  it("后端附加提示（超长截断）时跳转并把提示作为 notice 带到详情页", async () => {
    mocks.createQuestion.mockResolvedValue({
      data: { id: 43, title: "标题", status: "published", created_at: "" },
      message: "发布成功（内容超长已截断：标题 ≤ 100 字、正文 ≤ 20000 字）",
    });
    render(<PublishForm />);
    await fillForm();

    fireEvent.click(screen.getByRole("button", { name: "发布问题" }));

    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith(
        "/questions/43?notice=" +
          encodeURIComponent("发布成功（内容超长已截断：标题 ≤ 100 字、正文 ≤ 20000 字）"),
      ),
    );
  });
});
