import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  createQuestion: vi.fn(),
  fetchCourses: vi.fn(),
  fetchCourseDetail: vi.fn(),
  fetchTags: vi.fn(),
  role: "student",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("@/api/courses", () => ({
  fetchCourses: mocks.fetchCourses,
  fetchCourseDetail: mocks.fetchCourseDetail,
}));
vi.mock("@/api/tags", () => ({ fetchTags: mocks.fetchTags }));
vi.mock("@/api/questions", () => ({ createQuestion: mocks.createQuestion }));
vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({ user: { role: mocks.role }, status: "ready", load: vi.fn() }),
}));

import { PublishForm } from "./PublishForm";

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.createQuestion.mockReset();
  mocks.role = "student";
  mocks.fetchCourseDetail.mockReset().mockResolvedValue({ joined: true });
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

// waitReady=false：预检判定为「未加入」时按钮会被挡住，这类用例不能等它放开
async function fillForm({ waitReady = true } = {}) {
  await screen.findByRole("option", { name: /数据结构/ });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "1" } });
  if (waitReady) {
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发布问题" })).toHaveProperty("disabled", false),
    );
  }
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

  it("学生未加入所选课程时给出提示与入口，并挡住必然失败的提交", async () => {
    mocks.fetchCourseDetail.mockResolvedValue({ joined: false });
    render(<PublishForm />);
    await fillForm({ waitReady: false });

    await waitFor(() => expect(screen.getByText(/你还没加入这门课程/)).toBeTruthy());
    expect(screen.getByRole("link", { name: "去加入课程" }).getAttribute("href")).toBe("/courses/1");
    expect(screen.getByRole("button", { name: "发布问题" })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("button", { name: "发布问题" }));
    expect(mocks.createQuestion).not.toHaveBeenCalled();
  });

  it("教师未加入课程也能提交（后端允许课程负责教师发布）", async () => {
    mocks.role = "teacher";
    mocks.fetchCourseDetail.mockResolvedValue({ joined: false });
    mocks.createQuestion.mockResolvedValue({
      data: { id: 44, title: "标题", status: "published", created_at: "" },
      message: "发布成功",
    });
    render(<PublishForm />);
    await fillForm();

    await waitFor(() => expect(mocks.fetchCourseDetail).toHaveBeenCalledWith(1));
    expect(screen.queryByText(/你还没加入这门课程/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "发布问题" }));
    await waitFor(() => expect(mocks.createQuestion).toHaveBeenCalled());
  });

  it("加入状态预检完成前不放开提交（避免极快操作触发后端 403）", async () => {
    let resolveDetail: (value: { joined: boolean }) => void = () => {};
    mocks.fetchCourseDetail.mockReturnValue(
      new Promise<{ joined: boolean }>((resolve) => {
        resolveDetail = resolve;
      }),
    );
    render(<PublishForm />);
    await fillForm({ waitReady: false });

    expect(screen.getByRole("button", { name: "发布问题" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "发布问题" }));
    expect(mocks.createQuestion).not.toHaveBeenCalled();

    resolveDetail({ joined: true });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "发布问题" })).toHaveProperty("disabled", false),
    );
  });
});
