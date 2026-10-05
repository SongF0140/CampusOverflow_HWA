import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchTags: vi.fn(), fetchQuestionList: vi.fn() }));

vi.mock("@/api/tags", () => ({ fetchTags: mocks.fetchTags }));
vi.mock("@/api/questions", () => ({ fetchQuestionList: mocks.fetchQuestionList }));

import { TagDetailView } from "./TagDetailView";

beforeEach(() => {
  mocks.fetchTags.mockReset().mockResolvedValue({
    items: [{ id: 1, name: "红黑树", type: "tech", question_count: 3 }],
  });
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
    expect(mocks.fetchQuestionList).toHaveBeenCalledWith(
      expect.objectContaining({ tag_id: 1, page: 1 }),
    );
  });

  it("标签不在列表里时退化为「标签 #id」，问题列表仍可看", async () => {
    mocks.fetchTags.mockResolvedValue({ items: [] });
    render(<TagDetailView tagId={9} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "标签 #9" })).toBeTruthy());
    expect(screen.getByText("未找到标签资料")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "标签下的问题" })).toBeTruthy();
  });
});
