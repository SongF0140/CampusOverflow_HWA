import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { UserLine } from "./index";

afterEach(cleanup);

describe("UserLine", () => {
  it("头像 + 昵称 + 角色徽标，整行链接到用户主页", () => {
    render(<UserLine userId={7} nickname="李老师" role="teacher" />);
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("/users/7");
    expect(screen.getByText("李老师")).toBeTruthy();
    expect(screen.getByText("教师")).toBeTruthy();
  });

  it("学生角色显示学生徽标；graduateAssistant 追加助教徽标", () => {
    render(<UserLine userId={1} nickname="王小明" role="student" graduateAssistant />);
    expect(screen.getByText("学生")).toBeTruthy();
    expect(screen.getByText("助教")).toBeTruthy();
    expect(screen.queryByText("管理员")).toBeNull();
  });

  it("管理员角色徽标正确，不展示任何邮箱字段", () => {
    render(<UserLine userId="u-9" nickname="管理员老王" role="admin" />);
    expect(screen.getByText("管理员")).toBeTruthy();
    expect(screen.getByText("管理员老王")).toBeTruthy();
  });
});
