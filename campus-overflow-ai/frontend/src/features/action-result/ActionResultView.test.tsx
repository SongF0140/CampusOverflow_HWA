import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActionResultView, parseActionResultQuery } from "./ActionResultView";

describe("ActionResultView", () => {
  it("success：渲染成功图标与标题摘要，继续提问固定链到 /questions/new，无 return_to 不显示返回按钮", () => {
    render(
      <ActionResultView
        type="success"
        title="问题已发布"
        message="可以稍后在通知中查看进展"
        returnTo={null}
      />,
    );

    expect(screen.getByRole("img", { name: "成功" })).toBeTruthy();
    expect(screen.getByText("问题已发布")).toBeTruthy();
    expect(screen.getByText("可以稍后在通知中查看进展")).toBeTruthy();
    expect(screen.getByRole("link", { name: "继续提问" }).getAttribute("href")).toBe(
      "/questions/new",
    );
    expect(screen.queryByRole("link", { name: "返回来源页" })).toBeNull();
  });

  it("error：渲染失败图标与自定义标题，返回来源页链到 return_to", () => {
    render(
      <ActionResultView
        type="error"
        title="发布失败"
        message="内容未保存，请重试"
        returnTo="/questions/1"
      />,
    );

    expect(screen.getByRole("img", { name: "失败" })).toBeTruthy();
    expect(screen.getByText("发布失败")).toBeTruthy();
    expect(screen.getByRole("link", { name: "返回来源页" }).getAttribute("href")).toBe(
      "/questions/1",
    );
  });

  it("info：渲染中性提示图标；message 为空时不渲染摘要段", () => {
    const { container } = render(
      <ActionResultView type="info" title="温馨提示" message={null} returnTo={null} />,
    );

    expect(screen.getByRole("img", { name: "提示" })).toBeTruthy();
    expect(screen.getByText("温馨提示")).toBeTruthy();
    expect(container.querySelector("p")).toBeNull();
  });
});

describe("parseActionResultQuery", () => {
  it("完整参数：type/title/message/return_to 逐一映射", () => {
    expect(
      parseActionResultQuery({
        type: "error",
        title: "发布失败",
        message: "服务开小差了，请稍后重试",
        return_to: "/questions/1",
      }),
    ).toEqual({
      type: "error",
      title: "发布失败",
      message: "服务开小差了，请稍后重试",
      returnTo: "/questions/1",
    });
  });

  it("缺省与非法值：type 回退 info、标题按类型取默认、数组参数取首个", () => {
    expect(parseActionResultQuery({})).toEqual({
      type: "info",
      title: "温馨提示",
      message: null,
      returnTo: null,
    });
    expect(parseActionResultQuery({ type: "win" }).type).toBe("info");
    expect(parseActionResultQuery({ type: "success" }).title).toBe("操作成功");
    expect(parseActionResultQuery({ type: "error" }).title).toBe("操作失败");
    expect(parseActionResultQuery({ title: ["数组参数取首个"] }).title).toBe("数组参数取首个");
  });

  it("return_to 仅接受站内路径：外链与协议相对路径被忽略", () => {
    expect(parseActionResultQuery({ return_to: "https://evil.example.com" }).returnTo).toBeNull();
    expect(parseActionResultQuery({ return_to: "//evil.example.com" }).returnTo).toBeNull();
    expect(parseActionResultQuery({ return_to: "/notifications" }).returnTo).toBe("/notifications");
  });
});
