import {
  CERT_STATUS,
  IDENTITY_TYPE,
  USER_ROLE,
  type CertStatus,
  type IdentityType,
  type UserRole,
} from "@/shared/constants/domain";

/**
 * 助教能力位判定（US-20 / E-12）。
 *
 * 与后端 identity/domain.is_graduate_assistant 的三个条件**完全一致**：
 * 学生角色 + 研究生身份 + 助教认证通过；三者缺一不可
 * （教师/管理员即使满足后两条也不放行，本科生永不放行）。
 *
 * 前端只用它决定"助教板块入口是否渲染"；真正的权限仍由后端校验。
 */
export function isGraduateAssistant(user: {
  role: UserRole;
  identity_type: IdentityType;
  assistant_cert_status: CertStatus;
}): boolean {
  return (
    user.role === USER_ROLE.student &&
    user.identity_type === IDENTITY_TYPE.postgraduate &&
    user.assistant_cert_status === CERT_STATUS.approved
  );
}
