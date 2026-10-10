import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { VoteWidget } from "./index";

afterEach(cleanup);

describe("VoteWidget", () => {
  it("点击上下箭头回调对应方向", () => {
    const onVote = vi.fn();
    render(<VoteWidget score={12} myVote={0} onVote={onVote} />);
    fireEvent.click(screen.getByRole("button", { name: "赞同" }));
    fireEvent.click(screen.getByRole("button", { name: "反对" }));
    expect(onVote).toHaveBeenNthCalledWith(1, 1);
    expect(onVote).toHaveBeenNthCalledWith(2, -1);
  });

  it("已选方向高亮 brand（soft 底 + 深字）并标记 aria-pressed", () => {
    render(<VoteWidget score={12} myVote={-1} onVote={() => {}} />);
    const down = screen.getByRole("button", { name: "反对" });
    expect(down.className).toContain("bg-brand-soft");
    expect(down.className).toContain("text-brand-strong");
    expect(down.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "赞同" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("分数全角色可见", () => {
    render(<VoteWidget score={42} myVote={0} onVote={() => {}} />);
    expect(screen.getByText("42")).toBeTruthy();
  });

  it("未登录点击走 onNeedLogin，不触发投票回调", () => {
    const onVote = vi.fn();
    const onNeedLogin = vi.fn();
    render(
      <VoteWidget score={3} myVote={0} onVote={onVote} isLoggedIn={false} onNeedLogin={onNeedLogin} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "赞同" }));
    expect(onNeedLogin).toHaveBeenCalledTimes(1);
    expect(onVote).not.toHaveBeenCalled();
  });

  it("disabled 时点击不触发任何回调", () => {
    const onVote = vi.fn();
    const onNeedLogin = vi.fn();
    render(
      <VoteWidget
        score={3}
        myVote={0}
        onVote={onVote}
        isLoggedIn={false}
        onNeedLogin={onNeedLogin}
        disabled
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "赞同" }));
    expect(onVote).not.toHaveBeenCalled();
    expect(onNeedLogin).not.toHaveBeenCalled();
  });
});
