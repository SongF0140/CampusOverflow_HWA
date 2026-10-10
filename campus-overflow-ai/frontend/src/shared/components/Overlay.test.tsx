import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Drawer, Modal } from "./index";

afterEach(cleanup);

describe("Modal", () => {
  it("关闭不渲染；打开后 Escape 关闭", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open={false} title="编辑课程" onClose={onClose}>
        表单内容
      </Modal>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(
      <Modal open title="编辑课程" onClose={onClose}>
        表单内容
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("点击遮罩关闭；点击面板内部不关闭", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Modal open title="编辑课程" onClose={onClose}>
        <button type="button">面板内按钮</button>
      </Modal>,
    );
    fireEvent.click(screen.getByRole("button", { name: "面板内按钮" }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(container.firstElementChild as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("底部动作 slot 正常渲染", () => {
    const onConfirm = vi.fn();
    render(
      <Modal
        open
        title="编辑课程"
        onClose={() => {}}
        footer={
          <button type="button" onClick={onConfirm}>
            保存
          </button>
        }
      >
        表单内容
      </Modal>,
    );
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  // 请求进行中（dismissible=false）：审核这类"不可取消的提交"不能中途关掉，否则能再开一个弹窗并发提交
  it("dismissible=false：Escape 与遮罩点击都不关闭，也不影响面板内交互", () => {
    const onClose = vi.fn();
    const onInner = vi.fn();
    const { container } = render(
      <Modal open title="编辑课程" onClose={onClose} dismissible={false}>
        <button type="button" onClick={onInner}>
          面板内按钮
        </button>
      </Modal>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(container.firstElementChild as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "面板内按钮" }));
    expect(onInner).toHaveBeenCalledTimes(1);

    fireEvent(
      screen.getByRole("button", { name: "面板内按钮" }),
      new MouseEvent("click", { bubbles: true }),
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("Drawer", () => {
  it("dismissible=false：Escape 与遮罩点击都不关闭（封禁提交进行中用）", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Drawer open title="封禁用户" onClose={onClose} dismissible={false}>
        抽屉内容
      </Drawer>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(container.firstElementChild as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("默认 dismissible=true：Escape 仍可关闭", () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="封禁用户" onClose={onClose}>
        抽屉内容
      </Drawer>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Drawer", () => {
  it("关闭不渲染；打开后 Escape 关闭", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Drawer open={false} title="封禁用户" onClose={onClose}>
        封禁表单
      </Drawer>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(
      <Drawer open title="封禁用户" onClose={onClose}>
        封禁表单
      </Drawer>,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("右侧滑出容器 400px；点关闭按钮与遮罩均触发 onClose", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Drawer open title="封禁用户" onClose={onClose}>
        封禁表单
      </Drawer>,
    );
    const panel = screen.getByRole("dialog");
    expect(panel.className).toContain("w-[400px]");

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(container.firstElementChild as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("footer slot 正常渲染", () => {
    render(
      <Drawer open title="封禁用户" onClose={() => {}} footer={<button type="button">确认封禁</button>}>
        封禁表单
      </Drawer>,
    );
    expect(screen.getByRole("button", { name: "确认封禁" })).toBeTruthy();
  });
});
