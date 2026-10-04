import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiSuggestionCard, ConfirmDialog, EmptyState, StatusBadge } from "./index";

afterEach(cleanup);

describe("AiSuggestionCard", () => {
  const items = [
    { id: "t1", label: "数据结构", reason: "正文出现 3 次", confidence: 0.86 },
    { id: "t2", label: "算法", reason: "与站内问题相似", confidence: 0.61 },
  ];

  it("未勾选时不允许确认写入（未确认零写入）", () => {
    const onConfirm = vi.fn();
    render(<AiSuggestionCard title="推荐标签" state="ready" items={items} onConfirm={onConfirm} />);

    const confirm = screen.getByRole("button", { name: "确认写入" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("勾选后才发起写入，且只带勾选项", () => {
    const onConfirm = vi.fn();
    render(<AiSuggestionCard title="推荐标签" state="ready" items={items} onConfirm={onConfirm} />);

    fireEvent.click(screen.getByLabelText(/数据结构/));
    const confirm = screen.getByRole("button", { name: "确认写入" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledWith(["t1"]);
  });

  it("始终声明不会自动写入", () => {
    render(<AiSuggestionCard title="推荐标签" state="ready" items={items} />);
    expect(screen.getByText("未勾选确认前，不会写入任何数据")).toBeTruthy();
  });

  it("生成中显示检索提示，失败时可重试", () => {
    const onRetry = vi.fn();
    const { rerender } = render(<AiSuggestionCard title="相似问题" state="loading" />);
    expect(screen.getByText("正在检索站内问题…")).toBeTruthy();

    rerender(<AiSuggestionCard title="相似问题" state="error" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe("ConfirmDialog", () => {
  it("关闭时不渲染；取消与 ESC 均触发关闭", () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        open={false}
        title="确认删除这条问题？"
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(
      <ConfirmDialog open title="确认删除这条问题？" onConfirm={() => {}} onCancel={onCancel} />,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});

describe("StatusBadge / EmptyState", () => {
  it("状态徽标输出中文文字（不只靠颜色）", () => {
    render(<StatusBadge tone="unresolved" />);
    expect(screen.getByText("未解决")).toBeTruthy();
  });

  it("空状态渲染主操作并响应点击", () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        title="这门课还没有人提问"
        description="成为第一个提问的人"
        actionLabel="去提问"
        onAction={onAction}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "去提问" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
