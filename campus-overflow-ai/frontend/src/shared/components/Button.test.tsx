import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "./index";

afterEach(cleanup);

describe("Button", () => {
  it("点击触发 onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>发布</Button>);
    fireEvent.click(screen.getByRole("button", { name: "发布" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("loading 态禁点且不触发回调", () => {
    const onClick = vi.fn();
    render(
      <Button isLoading onClick={onClick}>
        发布中
      </Button>,
    );
    const button = screen.getByRole("button", { name: "发布中" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("disabled 态同样禁点", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        不可用
      </Button>,
    );
    const button = screen.getByRole("button", { name: "不可用" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("variant 与尺寸：primary 40px / ghost 默认 36px / danger 用语义红", () => {
    const { container, rerender } = render(<Button>主操作</Button>);
    expect(container.firstElementChild?.className).toContain("h-10");
    expect(container.firstElementChild?.className).toContain("bg-brand");

    rerender(<Button variant="ghost">次操作</Button>);
    expect(container.firstElementChild?.className).toContain("h-9");

    rerender(
      <Button variant="danger" size="md">
        删除
      </Button>,
    );
    expect(container.firstElementChild?.className).toContain("bg-danger");
  });
});
