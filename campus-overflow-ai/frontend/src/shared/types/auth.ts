// 认证与用户类型：字段与后端 identity 模块一致（蛇形命名）
// 角色/状态取值统一来自 shared/constants/domain.ts（单一来源，避免手写字符串写错）
import type { UserRole, UserStatus } from "@/shared/constants/domain";

export type { UserRole, UserStatus };

export interface UserProfile {
  id: number;
  username: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  ban_reason: string | null;
  reputation_score: number;
  bio: string | null;
  avatar_url: string | null;
  created_at: string;
}

/**
 * 后端 `POST /api/auth/login` 的**原始**响应。
 * 仅供 BFF 内部使用：access_token 会被写入 HttpOnly Cookie，不会返回给浏览器。
 */
export interface BackendLoginResult {
  access_token: string;
  token_type: string;
  user: UserProfile;
}

/**
 * BFF 脱敏后的登录响应：即浏览器实际拿到的形状（不含 access_token）。
 * 前端组件只能用这个类型，避免误以为能读到 token。
 */
export interface LoginResult {
  token_type: string;
  user: UserProfile;
}
