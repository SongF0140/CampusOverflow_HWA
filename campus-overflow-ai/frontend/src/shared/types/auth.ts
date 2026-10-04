// 认证与用户类型：字段与后端 identity 模块一致（蛇形命名，见 docs/前端架构/设计系统.md 与接口文档）
export type UserRole = "student" | "teacher" | "admin";

export type UserStatus = "active" | "banned";

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

export interface LoginResult {
  access_token: string;
  token_type: string;
  user: UserProfile;
}
