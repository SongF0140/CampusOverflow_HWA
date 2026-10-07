import type { QuestionListParams, QuestionListResult } from "@/shared/types/question";
import type {
  CourseDetail,
  CourseListItem,
  CourseListResult,
  CourseMemberListResult,
  ManagedCourse,
} from "@/shared/types/course";

import { apiFetch, apiFetchWithMessage, buildQuery } from "./client";

/** 课程列表（GET /api/courses）：可选参数缺省不出现在查询串 */
export function listCourses(
  params: { page?: number; page_size?: number; keyword?: string; semester?: string } = {},
) {
  return apiFetch<CourseListResult>(
    `/courses${buildQuery({
      page: params.page,
      page_size: params.page_size,
      keyword: params.keyword?.trim() || undefined,
      semester: params.semester?.trim() || undefined,
    })}`,
  );
}

export function fetchCourses(
  params: { page?: number; page_size?: number; keyword?: string; semester?: string } = {},
) {
  return listCourses(params);
}

export function fetchCourseDetail(id: number) {
  return apiFetch<CourseDetail>(`/courses/${id}`);
}

/**
 * 新建课程（POST /api/courses，仅教师角色）：编码全局唯一，创建者自动成为负责教师。
 * 用 WithMessage 版本拿到后端的中文提示（如「课程编码已存在」）。
 * 表单空值以 null 传入（与 CourseFormValues 一致，后端 Optional 字段接受 None）。
 */
export function createCourse(input: {
  name: string;
  code: string;
  description?: string | null;
  semester?: string | null;
}) {
  return apiFetchWithMessage<ManagedCourse>("/courses", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/**
 * 编辑课程（PATCH /api/courses/{id}）：仅负责教师与管理员（后端 E-06）。
 * 接口契约只接受 name / description / semester —— **课程编码不可改**。
 */
export function updateCourse(
  id: number,
  input: { name?: string; description?: string | null; semester?: string | null },
) {
  return apiFetchWithMessage<ManagedCourse>(`/courses/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/**
 * 我的课程（教师端 P-T02）：课程列表接口暂无 mine / teacher_id（后端缺口已登记），
 * 这里按 teacher_name 与当前用户名比对过滤，并逐页扫描，避免漏掉第一页之后的课程。
 */
export async function fetchMyCourses(username: string): Promise<CourseListItem[]> {
  const mine: CourseListItem[] = [];
  let page = 1;
  let scanned = 0;
  let total = Number.POSITIVE_INFINITY;
  // 主动限制：最多 20 页 = 2000 门课；后端补 mine 参数后本函数可简化为一次请求
  while (scanned < total && page <= 20) {
    const result = await fetchCourses({ page, page_size: 100 });
    total = result.total;
    scanned += result.items.length;
    mine.push(...result.items.filter((course) => course.teacher_name === username));
    if (result.items.length === 0) break;
    page += 1;
  }
  return mine;
}

/** 加入课程（POST /api/courses/{id}/join）：后端仅允许学生角色，重复加入返回 400 */
export function joinCourse(id: number) {
  return apiFetch<{ joined: boolean }>(`/courses/${id}/join`, { method: "POST" });
}

/** 退出课程（DELETE /api/courses/{id}/members/me）：仅本人可退出，未加入返回 400 */
export function leaveCourse(id: number) {
  return apiFetch<{ joined: boolean }>(`/courses/${id}/members/me`, { method: "DELETE" });
}

/** 课程成员列表（GET /api/courses/{id}/members）：仅负责教师与管理员可查（后端 E-06） */
export function fetchCourseMembers(
  id: number,
  params: { page?: number; page_size?: number } = {},
) {
  const query = new URLSearchParams();
  query.set("page", String(params.page ?? 1));
  query.set("page_size", String(params.page_size ?? 20));
  return apiFetch<CourseMemberListResult>(`/courses/${id}/members?${query.toString()}`);
}

/** 课程成员列表的历史命名别名（= fetchCourseMembers） */
export function listCourseMembers(
  id: number,
  params: { page?: number; page_size?: number } = {},
) {
  return fetchCourseMembers(id, params);
}

/**
 * 课程内问题列表：后端没有 GET /courses/{id}/questions（缺口已登记），
 * 走全局 GET /questions?course_id=（同参数同响应结构）。
 */
export function listCourseQuestions(courseId: number, params: QuestionListParams = {}) {
  return apiFetch<QuestionListResult>(
    `/questions${buildQuery({ course_id: courseId, ...params })}`,
  );
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
    // 课程列表是分页接口：逐页取完，避免把第一页当成全部课程
    courseNamesInflight = (async () => {
      const map: Record<number, string> = {};
      let page = 1;
      let total = Number.POSITIVE_INFINITY;
      // 主动限制：最多 20 页 = 2000 门课（当前是小型系统，这个量级足够），同时防 total 异常时死循环。
      // 若使用规模扩大：改为由问题列表接口直接返回 course_name（见后端缺口清单第 1 条），本函数即可删除。
      while (Object.keys(map).length < total && page <= 20) {
        const result = await fetchCourses({ page, page_size: 100 });
        total = result.total;
        for (const course of result.items) map[course.id] = course.name;
        if (result.items.length === 0) break;
        page += 1;
      }
      courseNames = map;
      return map;
    })()
      .catch(() => {
        // 拉取失败不缓存，下次挂载可重试；卡片本次退化为「课程 #id」
        courseNamesInflight = null;
        return {};
      });
  }
  return courseNamesInflight;
}
