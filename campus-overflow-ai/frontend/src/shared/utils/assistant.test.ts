import { describe, expect, it } from "vitest";

import { isGraduateAssistant } from "./assistant";

// 用例逐条对应后端 identity/domain.is_graduate_assistant 的三个条件
describe("isGraduateAssistant（与后端判定一致）", () => {
  it("学生 + 研究生 + 认证通过 → 是助教", () => {
    expect(
      isGraduateAssistant({
        role: "student",
        identity_type: "postgraduate",
        assistant_cert_status: "approved",
      }),
    ).toBe(true);
  });

  it("本科生永不放行", () => {
    expect(
      isGraduateAssistant({
        role: "student",
        identity_type: "undergraduate",
        assistant_cert_status: "approved",
      }),
    ).toBe(false);
  });

  it("未认证 / 被驳回不放行", () => {
    for (const status of ["none", "pending", "rejected"] as const) {
      expect(
        isGraduateAssistant({
          role: "student",
          identity_type: "postgraduate",
          assistant_cert_status: status,
        }),
      ).toBe(false);
    }
  });

  it("教师 / 管理员即使研究生且认证通过，也不具备助教能力位", () => {
    for (const role of ["teacher", "admin"] as const) {
      expect(
        isGraduateAssistant({
          role,
          identity_type: "postgraduate",
          assistant_cert_status: "approved",
        }),
      ).toBe(false);
    }
  });
});
