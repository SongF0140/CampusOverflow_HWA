// 搜索接口：GET /search?q=（discovery，跨问题全文检索）
import type { Paged } from "@/shared/types/common";
import type { QuestionListItem } from "@/shared/types/question";

import { apiFetch, buildQuery } from "./client";

export interface SearchParams {
  q: string;
  page?: number;
  page_size?: number;
  course_id?: number;
  tag_id?: number;
  sort?: "latest" | "hot";
  unresolved?: boolean;
  created_from?: string;
  created_before?: string;
}

// 全站搜索：q 必填；排序/筛选参数与问题列表一致
export function search(params: SearchParams) {
  return apiFetch<Paged<QuestionListItem>>(`/search${buildQuery(params)}`);
}
