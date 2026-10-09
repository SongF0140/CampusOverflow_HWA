// 投票接口：POST /votes，toggle 语义（重复同方向=取消，US-07/E-04）
import type { VoteInput, VoteResult } from "@/shared/types/vote";

import { apiFetch } from "./client";

// 提交/切换/取消投票：value 仅 ±1，回包带目标最新 vote_score 与当前用户 my_vote
export function createVote(input: VoteInput) {
  return apiFetch<VoteResult>("/votes", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
