// 投票类型：字段与后端 interaction/schemas.py VoteCreateRequest / VoteResultResponse 一致（蛇形）
export type VoteTargetType = "question" | "answer";

// 仅 ±1，同方向重复投票为取消（toggle 语义，US-07/E-04）
export type VoteValue = 1 | -1;

export interface VoteInput {
  target_type: VoteTargetType;
  target_id: number;
  value: VoteValue;
}

export interface VoteResult {
  target_type: string;
  target_id: number;
  vote_score: number;
  // 取消后为 0
  my_vote: number;
}
