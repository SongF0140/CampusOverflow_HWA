import type { UserRole, UserStatus } from "@/shared/constants/domain";

// 用户公开信息（identity/schemas.py UserPublicResponse）：**不含邮箱等隐私字段**
export interface PublicUser {
  id: number;
  username: string;
  role: UserRole;
  status: UserStatus;
  reputation_score: number;
  bio: string | null;
  avatar_url: string | null;
  created_at: string;
}

// 用户公开声誉（interaction/schemas.py PublicReputationResponse）：不含流水
export interface PublicReputation {
  user_id: number;
  username: string;
  reputation_score: number;
  question_count: number;
  answer_count: number;
}
