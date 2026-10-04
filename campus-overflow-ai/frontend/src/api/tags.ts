import type { TagListItem } from "@/shared/types/tag";

import { apiFetch } from "./client";

// 注意：后端 GET /api/tags 只支持 keyword 与 hot 两个参数（hot=true 已按绑定数取前 10），
// 不要再传 limit 之类的参数——后端会静默忽略，属于死参数。
export function fetchTags(params: { keyword?: string; hot?: boolean } = {}) {
  const query = new URLSearchParams();
  if (params.keyword?.trim()) query.set("keyword", params.keyword.trim());
  if (params.hot) query.set("hot", "true");
  const suffix = query.toString();
  return apiFetch<{ items: TagListItem[] }>(suffix ? `/tags?${suffix}` : "/tags");
}
