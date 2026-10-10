import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/api/notifications", () => ({
  listNotifications: mocks.listNotifications,
  markNotificationRead: mocks.markNotificationRead,
  markAllNotificationsRead: mocks.markAllNotificationsRead,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), prefetch: vi.fn() }),
}));

import { ApiError } from "@/api/client";
import type { NotificationsResult } from "@/shared/types/notification";

import { NotificationsView } from "./NotificationsView";

const RESULT: NotificationsResult = {
  items: [
    {
      id: 1,
      type: "answered",
      title: "你的问题收到新回答",
      link: "/questions/9#answer-4",
      is_read: false,
      created_at: "2026-10-05T10:00:00+08:00",
    },
    {
      id: 2,
      type: "accepted",
      title: "你的回答已被采纳",
      link: "/questions/9#answer-5",
      is_read: true,
      created_at: "2026-10-04T10:00:00+08:00",
    },
  ],
  total: 2,
  unread_count: 1,
  page: 1,
  page_size: 10,
};

// 仓库测试不引 jest-dom matchers，文本包含关系用原生 textContent 断言
function tabText(name: RegExp): string {
  return (screen.getByRole("tab", { name }) as HTMLButtonElement).textContent ?? "";
}

describe("NotificationsView", () => {
  beforeEach(() => {
    mocks.listNotifications.mockResolvedValue(RESULT);
    mocks.markNotificationRead.mockResolvedValue({ unread_count: 0 });
    mocks.markAllNotificationsRead.mockResolvedValue({ unread_count: 0 });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("默认渲染全部通知：未读行带红点，未读 Tab 红字计数", async () => {
    render(<NotificationsView />);

    expect(await screen.findByText("你的问题收到新回答")).toBeTruthy();
    expect(screen.getByText("你的回答已被采纳")).toBeTruthy();
    // 仅未读行有未读标记
    expect(screen.getAllByLabelText("未读")).toHaveLength(1);
    expect(tabText(/未读/)).toContain("1");
    // 首次拉取不筛未读
    expect(mocks.listNotifications).toHaveBeenCalledWith(
      expect.objectContaining({ unread_only: false, page: 1 }),
    );
  });

  it("切换未读 Tab：unread_only=true 重拉并回到第 1 页", async () => {
    render(<NotificationsView />);
    await screen.findByText("你的问题收到新回答");

    fireEvent.click(screen.getByRole("tab", { name: /未读/ }));

    await waitFor(() => {
      expect(mocks.listNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ unread_only: true, page: 1 }),
      );
    });
  });

  it("点击未读行：标记已读并跳转来源链接", async () => {
    render(<NotificationsView />);
    fireEvent.click(await screen.findByText("你的问题收到新回答"));

    await waitFor(() => {
      expect(mocks.markNotificationRead).toHaveBeenCalledWith(1);
    });
    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith("/questions/9#answer-4");
    });
  });

  it("点击已读行：直接跳转，不再发已读请求", async () => {
    render(<NotificationsView />);
    fireEvent.click(await screen.findByText("你的回答已被采纳"));

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith("/questions/9#answer-5");
    });
    expect(mocks.markNotificationRead).not.toHaveBeenCalled();
  });

  it("全部已读：调 read-all 并清零未读计数", async () => {
    render(<NotificationsView />);
    fireEvent.click(await screen.findByRole("button", { name: "全部已读" }));

    await waitFor(() => {
      expect(mocks.markAllNotificationsRead).toHaveBeenCalled();
    });
    // 未读数清零后 Tab 上红字消失，按钮置灰
    await waitFor(() => {
      expect(tabText(/未读/)).toBe("未读");
    });
    expect(
      (screen.getByRole("button", { name: "全部已读" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("空列表渲染空态：全部与未读文案区分", async () => {
    mocks.listNotifications.mockResolvedValue({
      items: [],
      total: 0,
      unread_count: 0,
      page: 1,
      page_size: 10,
    });
    render(<NotificationsView />);
    expect(await screen.findByText("暂无通知")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /未读/ }));
    expect(await screen.findByText("没有未读通知")).toBeTruthy();
  });

  it("加载失败渲染错误态，可重试", async () => {
    mocks.listNotifications.mockRejectedValue(new ApiError(500, "服务暂时不可用"));
    render(<NotificationsView />);

    expect(await screen.findByText("加载失败")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重新加载" })).toBeTruthy();
  });
});
