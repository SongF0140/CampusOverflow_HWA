import type { CourseDetail, CourseListResult } from "@/shared/types/course";

import { apiFetch } from "./client";

export function fetchCourses(params: { keyword?: string; page_size?: number } = {}) {
  const query = new URLSearchParams();
  query.set("page", "1");
  query.set("page_size", String(params.page_size ?? 50));
  if (params.keyword?.trim()) query.set("keyword", params.keyword.trim());
  return apiFetch<CourseListResult>(`/courses?${query.toString()}`);
}

export function fetchCourseDetail(id: number) {
  return apiFetch<CourseDetail>(`/courses/${id}`);
}
