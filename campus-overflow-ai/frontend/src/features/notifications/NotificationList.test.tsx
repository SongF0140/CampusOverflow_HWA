import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  fetchNotifications: vi.fn(),
  readNotification: vi.fn(),
  readAllNotifications: vi.fn(),
  setUnreadCount: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/api/notifications", () => ({
  fetchNotifications: mocks.fetchNotifications,
  readNotification: mocks.readNotification,
  readAllNotifications: mocks.readAllNotifications,
}));
vi.mock("@/shared/stores/notification-store", () => ({
  useNotificationStore: (selector: (state: { setUnreadCount: typeof mocks.setUnreadCount }) => unknown) =>
    selector({ setUnreadCount: mocks.setUnreadCount }),
}));

import { NotificationList } from "./NotificationList";

const UNREAD = {
  id: 1,
  type: "answered",
  title: "你的问题收到新回答",
  link: "/questions/4#answer-1",
  is_read: false,
  created_at: "2026-10-04T16:40:00",
};

beforeEach(() => {
  mocks.push.mockReset();
  mocks.setUnreadCount.mockReset();
  mocks.fetchNotifications.mockReset().mockResolvedValue({
    items: [UNREAD],
    total: 1,
    unread_count: 1,
    page: 1,
    page_size: 20,
  });
  mocks.readNotification.mockReset().mockResolvedValue({ unread_count: 0 });
  mocks.readAllNotifications.mockReset().mockResolvedValue({ unread_count: 0 });
});

afterEach(cleanup);

describe("NotificationList", () => {
  it("渲染通知标题与未读数", async () => {
    render(<NotificationList />);

    await waitFor(() => expect(screen.getByText("你的问题收到新回答")).toBeTruthy());
    expect(screen.getByText("1 条未读")).toBeTruthy();
    expect(screen.getByText("新回答")).toBeTruthy();
    expect(screen.getByText("未读")).toBeTruthy();
  });

  it("点击未读通知：先标记已读再跳转到 link", async () => {
    render(<NotificationList />);
    await waitFor(() => expect(screen.getByText("你的问题收到新回答")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: /你的问题收到新回答/ }));

    await waitFor(() => expect(mocks.readNotification).toHaveBeenCalledWith(1));
    expect(mocks.push).toHaveBeenCalledWith("/questions/4#answer-1");
    expect(mocks.setUnreadCount).toHaveBeenCalledWith(0);
  });

  it("空列表给出说明与主操作", async () => {
    mocks.fetchNotifications.mockResolvedValue({
      items: [],
      total: 0,
      unread_count: 0,
      page: 1,
      page_size: 20,
    });
    render(<NotificationList />);

    await waitFor(() => expect(screen.getByText("还没有通知")).toBeTruthy());
    expect(screen.getByRole("button", { name: "去问题广场" })).toBeTruthy();
  });

  it("通知超过一页时展示分页，翻页会带 page 重新请求", async () => {
    mocks.fetchNotifications.mockImplementation((params: { page?: number }) =>
      Promise.resolve({
        items: [UNREAD],
        total: 25,
        unread_count: 25,
        page: params.page ?? 1,
        page_size: 20,
      }),
    );
    render(<NotificationList />);

    await waitFor(() => expect(screen.getByText("第 1 / 2 页")).toBeTruthy());
    expect(screen.getByText("共 25 条")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));

    await waitFor(() =>
      expect(mocks.fetchNotifications).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2, pageSize: 20 }),
      ),
    );
    expect(screen.getByText("第 2 / 2 页")).toBeTruthy();
  });
});
