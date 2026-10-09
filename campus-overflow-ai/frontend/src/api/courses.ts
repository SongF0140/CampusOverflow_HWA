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
  params: { page?: number; page_size?: number; keyword?: string; semester?: string; mine?: boolean } = {},
) {
  return apiFetch<CourseListResult>(
    `/courses${buildQuery({
      page: params.page,
      page_size: params.page_size,
      keyword: params.keyword?.trim() || undefined,
      semester: params.semester?.trim() || undefined,
      mine: params.mine,
    })}`,
  );
}

export function fetchCourses(
  params: { page?: number; page_size?: number; keyword?: string; semester?: string; mine?: boolean } = {},
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
 * 负责课程由JWT对应用户的mine过滤，逐页读取，不扫描其他教师课程。
 */
export async function fetchMyCourses(): Promise<CourseListItem[]> {
  const mine: CourseListItem[] = [];
  let page = 1;
  let scanned = 0;
  let total = Number.POSITIVE_INFINITY;
  while (scanned < total) {
    const result = await fetchCourses({ page, page_size: 100, mine: true });
    total = result.total;
    scanned += result.items.length;
    mine.push(...result.items);
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
 * 课程内问题列表：固定资源路径，调用方不能覆盖course_id。
 */
export function listCourseQuestions(courseId: number, params: QuestionListParams = {}) {
  return apiFetch<QuestionListResult>(
    `/courses/${courseId}/questions${buildQuery({ ...params, course_id: undefined })}`,
  );
}

