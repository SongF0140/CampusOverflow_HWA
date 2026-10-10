import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyAssistantCertification: vi.fn(),
  loadMe: vi.fn(),
  session: { me: null as unknown, loadMe: null as unknown },
}));

vi.mock("@/api/users", () => ({
  applyAssistantCertification: mocks.applyAssistantCertification,
}));

vi.mock("@/shared/stores/session-store", () => ({
  useSessionStore: (selector: (state: typeof mocks.session) => unknown) => selector(mocks.session),
}));

import type { UserMe } from "@/shared/types/auth";

import { AssistantCertCard } from "./AssistantCertCard";

const MOCK_ME: UserMe = {
  id: 8,
  username: "student01",
  email: "student01@campus.edu",
  role: "student",
  status: "active",
  ban_reason: null,
  identity_type: "undergraduate",
  assistant_cert_status: "none",
  reputation_score: 10,
  bio: null,
  avatar_url: null,
  created_at: "2026-09-01T10:00:00+08:00",
};

function setMe(patch: Partial<UserMe>) {
  mocks.session.me = { ...MOCK_ME, ...patch };
}

beforeEach(() => {
  mocks.applyAssistantCertification.mockReset().mockResolvedValue({ ...MOCK_ME });
  mocks.loadMe.mockReset().mockResolvedValue(undefined);
  mocks.session.loadMe = mocks.loadMe;
  setMe({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AssistantCertCard", () => {
  it("未申请：可提交申请，成功后 Toast + 刷新登录态", async () => {
    render(<AssistantCertCard />);

    expect(screen.getByText("未申请")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "申请助教认证" }));

    await waitFor(() => expect(mocks.applyAssistantCertification).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("申请已提交，等待教师审核")).toBeTruthy();
    expect(mocks.loadMe).toHaveBeenCalled();
  });

  it("审核中：禁用按钮 + 说明，不发请求（pending 禁重复）", async () => {
    setMe({ assistant_cert_status: "pending" });
    render(<AssistantCertCard />);

    const button = screen.getByRole("button", { name: "审核中，暂不可重复申请" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(mocks.applyAssistantCertification).not.toHaveBeenCalled();
  });

  it("已通过：禁用按钮 + 能力位说明", async () => {
    setMe({ assistant_cert_status: "approved", identity_type: "postgraduate" });
    render(<AssistantCertCard />);

    expect(screen.getByText("已通过")).toBeTruthy();
    expect((screen.getByRole("button", { name: "认证已通过" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("已驳回：可重新申请", async () => {
    setMe({ assistant_cert_status: "rejected" });
    render(<AssistantCertCard />);

    expect(screen.getByText("已驳回")).toBeTruthy();
    expect((screen.getByRole("button", { name: "重新申请" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("教师不渲染助教申请入口", async () => {
    setMe({ role: "teacher" });
    const { container } = render(<AssistantCertCard />);

    expect(container.textContent).toBe("");
  });
});
