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

let courseNames: Record<number, string> | null = null;
let courseNamesInflight: Promise<Record<number, string>> | null = null;

/**
 * 课程名映射：问题列表条目只有 course_id（后端响应暂无 course_name），
 * 用一次课程列表请求建映射并全站复用（模块级缓存 + 并发去重）。
 * 后端补 course_name 后本函数即可删除。
 */
export function fetchCourseNameMap(): Promise<Record<number, string>> {
  if (courseNames) return Promise.resolve(courseNames);
  if (!courseNamesInflight) {
    // ponytail: 只取前 100 门课；课程数更多时少量卡片退化为「课程 #id」
    courseNamesInflight = fetchCourses({ page_size: 100 })
      .then((result) => {
        const map: Record<number, string> = Object.fromEntries(
          result.items.map((course) => [course.id, course.name]),
        );
        courseNames = map;
        return map;
      })
      .catch(() => {
        // 拉取失败不缓存，下次挂载可重试；卡片本次退化为「课程 #id」
        courseNamesInflight = null;
        return {};
      });
  }
  return courseNamesInflight;
}
