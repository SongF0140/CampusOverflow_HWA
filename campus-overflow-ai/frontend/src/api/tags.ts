import type { TagListItem } from "@/shared/types/tag";

import { apiFetch, buildQuery } from "./client";

export function fetchTag(id: number) {
  return apiFetch<TagListItem>(`/tags/${id}`);
}

// 注意：后端 GET /api/tags 只支持 keyword 与 hot 两个参数（hot=true 已按绑定数取前 10），
// 不要再传 limit 之类的参数——后端会静默忽略，属于死参数。
export function listTags(params: { keyword?: string; hot?: boolean } = {}) {
  const query = buildQuery({
    keyword: params.keyword?.trim() || undefined,
    hot: params.hot ? true : undefined,
  });
  return apiFetch<{ items: TagListItem[] }>(`/tags${query}`);
}

export function fetchTags(params: { keyword?: string; hot?: boolean } = {}) {
  return listTags(params);
}
