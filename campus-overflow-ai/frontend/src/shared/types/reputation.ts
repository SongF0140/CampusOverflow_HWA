// 声誉类型：字段与后端 interaction/schemas.py 完全一致（蛇形）
// 契约来源：学生端接口文档 §2/§6、需求文档 4.7

// 积分流水条目（GET /reputation/me 的 logs 元素）：积分变化必有流水
export interface ReputationFlow {
  delta: number;
  reason: string;
  ref_type: string;
  ref_id: number;
  created_at: string;
}

// 我的积分与流水回包（GET /reputation/me；E-11 流水仅本人可见）
export interface ReputationSummary {
  score: number;
  logs: ReputationFlow[];
  total: number;
  page: number;
  page_size: number;
}

// 用户公开声誉（GET /users/{id}/reputation）：不含流水（E-11）
export interface PublicReputation {
  user_id: number;
  username: string;
  reputation_score: number;
  question_count: number;
  answer_count: number;
}

// 榜单条目（GET /reputation/rank）：无名次字段，名次由前端按顺序计算
export interface RankingEntry {
  user_id: number;
  username: string;
  score: number;
}

export interface RankResult {
  items: RankingEntry[];
}

export type RankPeriod = "week" | "month" | "all";

export interface RankParams {
  period?: RankPeriod;
  course_id?: number;
}

export interface MyReputationParams {
  page?: number;
  page_size?: number;
}
