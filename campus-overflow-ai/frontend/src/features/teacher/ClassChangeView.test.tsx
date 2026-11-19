import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClassChangeView } from "./ClassChangeView";

const mocks = vi.hoisted(() => ({ read: vi.fn(), decide: vi.fn() }));
vi.mock("@/api/class-changes", () => ({ fetchClassChange: mocks.read, confirmClassChange: mocks.decide }));
const pending = { request_id: "req", course_id: 2, course_name: "操作系统", action: "add", status: "pending",
  students: [{ user_id: 3, username: "学生甲", joined: false }], requires_confirmation: true, executed: false };
beforeEach(() => { mocks.read.mockResolvedValue(pending); mocks.decide.mockResolvedValue({ ...pending, status: "executed", executed: true }); mocks.decide.mockClear(); });
describe("教师确认名单变更", () => {
  it("先显示清单，只有明确点击才执行", async () => {
    render(<ClassChangeView courseId={2} requestId="req" />);
    expect(await screen.findByText("学生甲")).toBeTruthy();
    expect(mocks.decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认加入班级" }));
    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith("req", "confirm"));
    expect(await screen.findByText(/已执行/)).toBeTruthy();
  });
  it("错误课程不展示确认按钮", async () => {
    render(<ClassChangeView courseId={8} requestId="req" />);
    expect(await screen.findByText("变更清单与当前课程不一致")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "确认加入班级" })).toBeNull();
  });
});
