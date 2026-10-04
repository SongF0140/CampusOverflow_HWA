import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { QuestionList } from "./QuestionList";

afterEach(cleanup);

describe("QuestionList", () => {
  it("加载完成后渲染问题卡片（含课程、标签与统计）", async () => {
    render(<QuestionList />);

    expect(screen.getByRole("heading", { name: "问题广场" })).toBeTruthy();
    await waitFor(
      () => expect(screen.getByText(/红黑树的删除操作/)).toBeTruthy(),
      { timeout: 3000 },
    );
    expect(screen.getAllByText("数据结构").length).toBeGreaterThan(0);
    expect(screen.getByText(/共 \d+ 条/)).toBeTruthy();
  });

  it("关键词无匹配时展示空状态，清除筛选后恢复列表", async () => {
    render(<QuestionList initialKeyword="绝对不存在的关键词" />);

    await waitFor(
      () => expect(screen.getByText("没有找到符合条件的问题")).toBeTruthy(),
      { timeout: 3000 },
    );

    fireEvent.click(screen.getByRole("button", { name: "清除筛选" }));

    await waitFor(
      () => expect(screen.getByText(/红黑树的删除操作/)).toBeTruthy(),
      { timeout: 3000 },
    );
  });

  it("只看未解决会过滤掉已解决的问题", async () => {
    render(<QuestionList />);
    await waitFor(() => expect(screen.getByText(/红黑树的删除操作/)).toBeTruthy(), { timeout: 3000 });

    fireEvent.click(screen.getByRole("button", { name: "只看未解决" }));

    await waitFor(
      () => {
        // 重新加载期间会先显示骨架屏，因此两个断言放在同一个 waitFor 里重试
        expect(screen.queryByText(/TCP 三次握手/)).toBeNull();
        expect(screen.getByText(/红黑树的删除操作/)).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });
});
