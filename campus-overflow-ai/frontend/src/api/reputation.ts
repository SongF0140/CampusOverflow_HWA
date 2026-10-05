import type { RankPeriod } from "@/shared/constants/domain";
import type { RankRow } from "@/shared/types/reputation";

import { apiFetch } from "./client";

/** 积分榜单（GET /api/reputation/rank）：period=week|month|all；course_id 给定时为课程榜 */
export function fetchRanking(params: { period?: RankPeriod; course_id?: number } = {}) {
  const query = new URLSearchParams();
  query.set("period", params.period ?? "all");
  if (params.course_id) query.set("course_id", String(params.course_id));
  return apiFetch<{ items: RankRow[] }>(`/reputation/rank?${query.toString()}`);
}
