import type { TagListItem } from "@/shared/types/tag";

import { apiFetch } from "./client";

export function fetchTags(params: { keyword?: string; hot?: boolean; limit?: number } = {}) {
  const query = new URLSearchParams();
  if (params.keyword?.trim()) query.set("keyword", params.keyword.trim());
  if (params.hot) query.set("hot", "true");
  query.set("limit", String(params.limit ?? 20));
  return apiFetch<{ items: TagListItem[] }>(`/tags?${query.toString()}`);
}
