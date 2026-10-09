import type { RankParams, MyReputationParams, RankResult, ReputationSummary } from "@/shared/types/reputation";

import { apiFetch, buildQuery } from "./client";

/** 积分榜单（GET /api/reputation/rank）：period=week|month|all；course_id 给定时为课程榜 */
export function getRank(params: RankParams = {}) {
  return apiFetch<RankResult>(`/reputation/rank${buildQuery(params)}`);
}

export function fetchRanking(params: { period?: RankParams["period"]; course_id?: number } = {}) {
  return getRank(params);
}

/** 我的积分与流水（GET /api/reputation/me）：流水仅本人可见（E-11） */
export function getMyReputation(params: MyReputationParams = {}) {
  return apiFetch<ReputationSummary>(`/reputation/me${buildQuery(params)}`);
}
