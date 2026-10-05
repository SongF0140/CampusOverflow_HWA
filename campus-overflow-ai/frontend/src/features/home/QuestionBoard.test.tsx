import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuestionBoard } from "./QuestionBoard";
import type { Course } from "@/shared/types/course";
import type { QuestionListItem } from "@/shared/types/question";
import type { TagListItem } from "@/shared/types/tag";
import type { RankingEntry } from "@/shared/types/reputation";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  params: new URLSearchParams(),
  listQuestions: vi.fn(),
  listCourses: vi.fn(),
  listTags: vi.fn(),
  getRank: vi.fn(),
  status: "guest" as "loading" | "authed" | "guest",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: () => mocks.params,
}));

vi.mock("@/api/questions", () => ({ listQuestions: mocks.listQuestions }));
vi.mock("@/api/courses", () => ({ listCourses: mocks.listCourses }));
vi.mock("@/api/tags", () => ({ listTags: mocks.listTags }));
vi.mock("@/api/reputation", () => ({ getRank: mocks.getRank }));

interface SessionShape {
  me: null;
  status: "loading" | "authed" | "guest";
  loadMe: () => Promise<void>;
  logout: () => Promise<void>;
}

vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: SessionShape) => unknown) =>
    selector({ me: null, status: mocks.status, loadMe: vi.fn(), logout: vi.fn() }),
}));

const QUESTION: QuestionListItem = {
  id: 101,
  title: "红黑树的删除操作为什么要分四种情况讨论？",
  course_id: 1,
  author: "李同学",
  tags: [{ id: 5, name: "面试高频", type: "custom" }],
  status: "unresolved",
  vote_score: 12,
  my_vote: 0,
  answer_count: 3,
  view_count: 218,
  has_accepted: false,
  created_at: "2026-10-06T09:12:00+08:00",
};

const COURSES: Course[] = [
  { id: 1, name: "数据结构", code: "CS201", teacher_name: "张老师", member_count: 60, question_count: 24, created_at: "2026-09-01T08:00:00" },
  { id: 2, name: "操作系统", code: "CS301", teacher_name: "刘老师", member_count: 55, question_count: 18, created_at: "2026-09-01T08:00:00" },
];

const TAGS: TagListItem[] = [{ id: 5, name: "面试高频", type: "custom", question_count: 9 }];

const RANK: RankingEntry[] = [{ user_id: 11, username: "赵同学", score: 320 }];

function makePaged(page = 1, items: QuestionListItem[] = [QUESTION]) {
  return { items, total: items.length > 0 ? 25 : 0, page, page_size: 10 };
}

// 模拟 router.replace 后 URL 生效：更新 useSearchParams 的返回值并重渲染
function navigate(query: string, rerender: (ui: ReactElement) => void) {
  mocks.params = new URLSearchParams(query);
  rerender(<QuestionBoard />);
}

beforeEach(() => {
  mocks.push.mockReset();
  mocks.replace.mockReset();
  mocks.status = "guest";
  mocks.params = new URLSearchParams();
  mocks.listQuestions.mockReset().mockResolvedValue(makePaged());
  mocks.listCourses.mockReset().mockResolvedValue({ items: COURSES, total: 2, page: 1, page_size: 100 });
  mocks.listTags.mockReset().mockResolvedValue({ items: TAGS });
  mocks.getRank.mockReset().mockResolvedValue({ items: RANK });
});

afterEach(cleanup);

async function renderBoard() {
  const utils = render(<QuestionBoard />);
  // 等待列表与筛选选项加载完成（课程选项多于"全部课程"一项即说明 listCourses 已返回）
  await screen.findByText(/红黑树的删除操作/);
  await waitFor(() =>
    expect((screen.getByLabelText("按课程筛选") as HTMLSelectElement).options.length).toBeGreaterThan(
      1,
    ),
  );
  return utils;
}

describe("QuestionBoard 筛选状态以 URL 为唯一来源", () => {
  it("切换课程筛选写入 URL（replace），并按新条件重拉第 1 页", async () => {
    const { rerender } = await renderBoard();
    expect(screen.getByRole("heading", { name: "问题广场" })).toBeTruthy();
    expect(mocks.listQuestions).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }));

    fireEvent.change(screen.getByLabelText("按课程筛选"), { target: { value: "2" } });
    expect(mocks.replace).toHaveBeenCalledWith("/?course_id=2");

    navigate("course_id=2", rerender);
    await waitFor(() =>
      expect(mocks.listQuestions).toHaveBeenLastCalledWith(
        expect.objectContaining({ course_id: 2, page: 1, page_size: 10 }),
      ),
    );
  });

  it("排序/状态 Tab 切换写入 URL 并重拉（sort=hot、unresolved=1）", async () => {
    const { rerender } = await renderBoard();

    fireEvent.click(screen.getByRole("tab", { name: "热门" }));
    expect(mocks.replace).toHaveBeenCalledWith("/?sort=hot");
    navigate("sort=hot", rerender);
    await waitFor(() =>
      expect(mocks.listQuestions).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: "hot" }),
      ),
    );
    expect(screen.getByRole("tab", { name: "热门" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("tab", { name: "未解决" }));
    expect(mocks.replace).toHaveBeenCalledWith("/?sort=hot&unresolved=1");
    navigate("sort=hot&unresolved=1", rerender);
    await waitFor(() =>
      expect(mocks.listQuestions).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: "hot", unresolved: true }),
      ),
    );
  });

  it("翻页写入 URL page 参数并按新页码重拉", async () => {
    const { rerender } = await renderBoard();
    expect(screen.getByText("共 25 条")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(mocks.replace).toHaveBeenCalledWith("/?page=2");

    navigate("page=2", rerender);
    await waitFor(() =>
      expect(mocks.listQuestions).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })),
    );
  });

  it("初始读取 searchParams 回填控件与列表（含深链 page）", async () => {
    mocks.params = new URLSearchParams("course_id=2&sort=hot&unresolved=1&page=2");
    render(<QuestionBoard />);

    const courseSelect = screen.getByLabelText("按课程筛选") as HTMLSelectElement;
    await waitFor(() => expect(courseSelect.value).toBe("2"));
    expect(screen.getByRole("tab", { name: "热门" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "未解决" }).getAttribute("aria-selected")).toBe("true");
    // 深链直达第 2 页：初始第 1 页后按 URL 翻到第 2 页
    await waitFor(() =>
      expect(mocks.listQuestions).toHaveBeenLastCalledWith(
        expect.objectContaining({ course_id: 2, sort: "hot", unresolved: true, page: 2 }),
      ),
    );
  });
});

describe("QuestionBoard 列表三态", () => {
  it("加载中渲染骨架屏（无卡片）", () => {
    mocks.listQuestions.mockReturnValue(new Promise(() => {}));
    render(<QuestionBoard />);

    expect(screen.getByText("正在加载内容")).toBeTruthy();
    expect(screen.queryByText(/红黑树的删除操作/)).toBeNull();
  });

  it("加载失败显示错误态，重试后恢复列表", async () => {
    mocks.listQuestions.mockRejectedValueOnce(new Error("网络开小差了"));
    render(<QuestionBoard />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/网络开小差了/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(await screen.findByText(/红黑树的删除操作/)).toBeTruthy();
  });

  it("空列表显示空态引导提问", async () => {
    mocks.listQuestions.mockResolvedValue(makePaged(1, []));
    render(<QuestionBoard />);

    expect(await screen.findByText("还没有问题，来提第一个")).toBeTruthy();
    // 筛选条与空态各有一个提问按钮
    expect(screen.getAllByRole("button", { name: /提问/ }).length).toBe(2);
  });
});

describe("QuestionBoard ＋提问登录态分流", () => {
  it("游客点击 → /auth/login?returnTo=/questions/new", async () => {
    await renderBoard();

    fireEvent.click(screen.getByRole("button", { name: /提问/ }));
    expect(mocks.push).toHaveBeenCalledWith("/auth/login?returnTo=%2Fquestions%2Fnew");
    expect(mocks.push).not.toHaveBeenCalledWith("/questions/new");
  });

  it("已登录点击 → /questions/new", async () => {
    mocks.status = "authed";
    await renderBoard();

    fireEvent.click(screen.getByRole("button", { name: /提问/ }));
    expect(mocks.push).toHaveBeenCalledWith("/questions/new");
  });
});

describe("QuestionBoard 右栏", () => {
  it("热门用户（周榜 TOP5 + 完整榜单入口）与标签云正常渲染", async () => {
    render(<QuestionBoard />);

    expect(await screen.findByText("热门用户")).toBeTruthy();
    expect(screen.getByRole("link", { name: "查看完整榜单" }).getAttribute("href")).toBe("/rankings");
    // UserLine 的可访问名含昵称与角色徽标，用模糊匹配
    expect(screen.getByRole("link", { name: /赵同学/ }).getAttribute("href")).toBe("/users/11");
    expect(screen.getByText("热门标签")).toBeTruthy();
    // 标签链接在问题卡与标签云各出现一次，均指向标签页
    const tagLinks = screen.getAllByRole("link", { name: /面试高频/ });
    expect(tagLinks.length).toBe(2);
    for (const link of tagLinks) {
      expect(link.getAttribute("href")).toBe("/tags/5");
    }
  });

  it("右栏数据为空时对应卡片整体隐藏，AI 助手卡不渲染", async () => {
    mocks.getRank.mockResolvedValue({ items: [] });
    mocks.listTags.mockResolvedValue({ items: [] });
    render(<QuestionBoard />);

    await waitFor(() => expect(screen.queryByText("热门用户")).toBeNull());
    expect(screen.queryByText("热门标签")).toBeNull();
    expect(screen.queryByText("AI 助手")).toBeNull();
  });
});
