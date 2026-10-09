import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownView } from "./index";

afterEach(cleanup);

describe("MarkdownView", () => {
  it("渲染标题、正文与链接", () => {
    render(<MarkdownView content={"# 标题一\n\n正文段落 [参考链接](https://example.com)"} />);
    expect(screen.getByRole("heading", { name: "标题一" })).toBeTruthy();
    const link = screen.getByRole("link", { name: "参考链接" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("不渲染原始 HTML（未启用 rehype-raw，XSS 清洗口径）", () => {
    const { container } = render(
      <MarkdownView
        content={'<script>alert(1)</script>\n\n<img src=x onerror="alert(1)" />剩余正文文字'}
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("代码块渲染为 pre 容器", () => {
    const { container } = render(<MarkdownView content={"```\nconst a = 1\n```"} />);
    expect(container.querySelector("pre")).toBeTruthy();
  });
});
