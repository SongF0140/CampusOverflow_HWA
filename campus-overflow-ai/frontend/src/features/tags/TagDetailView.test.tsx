import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/api/client";

const mocks = vi.hoisted(() => ({ fetchTag: vi.fn(), fetchQuestionList: vi.fn() }));

vi.mock("@/api/tags", () => ({ fetchTag: mocks.fetchTag }));
vi.mock("@/api/questions", () => ({ fetchQuestionList: mocks.fetchQuestionList }));

import { TagDetailView } from "./TagDetailView";

beforeEach(() => {
  mocks.fetchTag.mockReset().mockResolvedValue({ id: 1, name: "红黑树", type: "tech", question_count: 3 });
  mocks.fetchQuestionList.mockReset().mockResolvedValue({
    items: [],
    total: 0,
    page: 1,
    page_size: 20,
  });
});

afterEach(cleanup);

describe("TagDetailView", () => {
  it("按 id 匹配标签信息，并按 tag_id 拉取问题列表", async () => {
    render(<TagDetailView tagId={1} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "红黑树" })).toBeTruthy());
    expect(screen.getByText("技术标签")).toBeTruthy();
    expect(screen.getByText("3 个问题")).toBeTruthy();
    // 标签信息与问题列表是两个独立 effect，没有先后保证：必须 await，否则偶发失败
    await waitFor(() =>
      expect(mocks.fetchQuestionList).toHaveBeenCalledWith(
        expect.objectContaining({ tag_id: 1, page: 1 }),
      ),
    );
  });

  it("不存在标签显示资源错误且不查询问题", async () => {
    mocks.fetchTag.mockRejectedValue(new ApiError(404, "标签不存在"));
    render(<TagDetailView tagId={9} />);

    expect(await screen.findByText("标签不存在")).toBeTruthy();
    expect(mocks.fetchQuestionList).not.toHaveBeenCalled();
  });

  it("零关联问题的标签仍显示真实资料", async () => {
    mocks.fetchTag.mockResolvedValue({ id: 1, name: "零问题标签", type: "tech", question_count: 0 });
    render(<TagDetailView tagId={1} />);
    expect(await screen.findByRole("heading", { name: "零问题标签" })).toBeTruthy();
    expect(mocks.fetchTag).toHaveBeenCalledWith(1);
    await waitFor(() => expect(mocks.fetchQuestionList).toHaveBeenCalled());
    expect(screen.queryByText("标签不存在")).toBeNull();
  });

  it("URL 里的筛选条件回填到问题列表", async () => {
    render(<TagDetailView tagId={1} initialKeyword="E2E" initialUnresolved />);

    await waitFor(() =>
      expect(mocks.fetchQuestionList).toHaveBeenCalledWith(
        expect.objectContaining({ tag_id: 1, keyword: "E2E", unresolved: true }),
      ),
    );
  });
});
