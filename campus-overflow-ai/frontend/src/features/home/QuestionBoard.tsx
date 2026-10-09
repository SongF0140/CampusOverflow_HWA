"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { listCourses } from "@/api/courses";
import { listQuestions } from "@/api/questions";
import { listTags } from "@/api/tags";
import { useAsyncData } from "@/shared/hooks/useAsyncData";
import { usePagedList } from "@/shared/hooks/usePagedList";
import { useSessionStore } from "@/shared/stores/session-store";
import { EmptyState, ErrorState, LoadingSkeleton, Pagination } from "@/shared/components";
import type { QuestionListParams, QuestionSort } from "@/shared/types/question";

import { QuestionCard } from "@/features/questions/QuestionCard";

import { QuestionFilterBar, type QuestionFilters } from "./QuestionFilterBar";
import { RightRail } from "./RightRail";

const PAGE_SIZE = 10;
// 课程 Select 选项上限：取足够大的一页以覆盖选项与课程名映射
const COURSE_OPTION_LIMIT = 100;

// URL 持有的全部筛选条件（course_id/tag_id/sort/unresolved/page）
interface BoardFilters extends QuestionFilters {
  page: number;
}

function parsePositiveInt(raw: string | null): number | undefined {
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

export function parseBoardFilters(params: URLSearchParams): BoardFilters {
  return {
    courseId: parsePositiveInt(params.get("course_id")),
    tagId: parsePositiveInt(params.get("tag_id")),
    sort: params.get("sort") === "hot" ? "hot" : "latest",
    unresolved: params.get("unresolved") === "1" || params.get("unresolved") === "true",
    page: parsePositiveInt(params.get("page")) ?? 1,
  };
}

// 发给接口的查询：缺省值不传（unresolved=false、latest 均为后端默认）
function filtersToQuery(filters: BoardFilters): QuestionListParams {
  return {
    course_id: filters.courseId,
    tag_id: filters.tagId,
    sort: filters.sort,
    unresolved: filters.unresolved ? true : undefined,
  };
}

// 筛选条件 → URL 路径：默认值不写入，保持 URL 简洁且可完整回填
function filtersToPath(filters: BoardFilters): string {
  const params = new URLSearchParams();
  if (filters.courseId !== undefined) params.set("course_id", String(filters.courseId));
  if (filters.tagId !== undefined) params.set("tag_id", String(filters.tagId));
  if (filters.sort === "hot") params.set("sort", "hot");
  if (filters.unresolved) params.set("unresolved", "1");
  if (filters.page > 1) params.set("page", String(filters.page));
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

function filtersSignature(filters: BoardFilters): string {
  return [
    filters.courseId ?? "",
    filters.tagId ?? "",
    filters.sort,
    filters.unresolved ? "1" : "0",
    filters.page,
  ].join("|");
}

// 问题广场主组件（§2.3）：URL searchParams 为唯一筛选状态源——
// 控件变更只写 URL（router.replace），列表同步统一由 URL 变化驱动（浏览器回退/前进同路径生效）
export function QuestionBoard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionStatus = useSessionStore((state) => state.status);

  // 初始筛选只在首挂载读取一次，作为 usePagedList 的初始查询，避免首帧后二次拉取
  const [initialFilters] = useState<BoardFilters>(() => parseBoardFilters(searchParams));
  const {
    items,
    total,
    page,
    pageSize,
    isLoading,
    error,
    reload,
    setParams,
    setPage,
  } = usePagedList(listQuestions, filtersToQuery(initialFilters), PAGE_SIZE);

  // URL → 列表同步。appliedRef 记录已应用的筛选签名：控件事先 replace 的导航不重复应用，
  // 仅响应外部变化（浏览器回退/前进、代码改 URL）。初始签名视为 page=1（usePagedList 恒从 1 起拉）
  const appliedRef = useRef<string>(filtersSignature({ ...initialFilters, page: 1 }));
  useEffect(() => {
    const next = parseBoardFilters(searchParams);
    const signature = filtersSignature(next);
    if (signature === appliedRef.current) return;
    appliedRef.current = signature;
    if (next.page > 1) {
      // setParams + setPage 同批提交，只触发一次重取（deep link 直达第 N 页）
      setParams(filtersToQuery({ ...next, page: 1 }));
      setPage(next.page);
    } else {
      setParams(filtersToQuery(next)); // setParams 内部会重置回第 1 页
    }
  }, [searchParams, setParams, setPage]);

  // 控件变更 → 写 URL；列表更新由上方 effect 在 searchParams 变化后统一执行
  const updateFilters = useCallback(
    (patch: Partial<QuestionFilters> & { page?: number }) => {
      const current = parseBoardFilters(searchParams);
      // 筛选变更回第 1 页；翻页时显式携带 page
      const next: BoardFilters = { ...current, ...patch, page: patch.page ?? 1 };
      router.replace(filtersToPath(next));
    },
    [router, searchParams],
  );

  // ＋提问登录态分流：游客先去登录并带回跳（§2.3）
  const handleAsk = useCallback(() => {
    if (sessionStatus === "authed") {
      router.push("/questions/new");
      return;
    }
    router.push(`/auth/login?returnTo=${encodeURIComponent("/questions/new")}`);
  }, [router, sessionStatus]);

  // 课程选项 + course_id → 课程名映射（问题卡展示用）
  const coursesState = useAsyncData(
    () => listCourses({ page: 1, page_size: COURSE_OPTION_LIMIT }),
    [],
  );
  const courseNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const course of coursesState.data?.items ?? []) map.set(course.id, course.name);
    return map;
  }, [coursesState.data]);
  const courseNameOf = useCallback(
    (courseId: number) => courseNameById.get(courseId) ?? `课程 ${courseId}`,
    [courseNameById],
  );

  // 标签选项（Select 用全量列表；右栏热门标签由 RightRail 自行拉 hot）
  const tagsState = useAsyncData(() => listTags({}), []);

  const currentFilters = parseBoardFilters(searchParams);

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[22px] font-semibold text-ink">问题广场</h1>

      <QuestionFilterBar
        filters={currentFilters}
        courses={coursesState.data?.items ?? []}
        tags={tagsState.data?.items ?? []}
        isTaxonomyLoading={coursesState.isLoading || tagsState.isLoading}
        onChange={updateFilters}
        onAsk={handleAsk}
      />

      {/* 主区 8 列 + 右栏 4 列；窄屏右栏下沉（§0.1） */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          {/* 列表三态（§2.3）：骨架 / 错误重试 / 空态引导提问，就绪后卡片 + 分页 */}
          {isLoading ? <LoadingSkeleton variant="list" count={5} /> : null}
          {error !== null ? <ErrorState message={error} onRetry={reload} /> : null}
          {!isLoading && error === null && items.length === 0 ? (
            <EmptyState
              title="还没有问题，来提第一个"
              description="好问题从提问开始，选择课程并添加标签，更容易获得解答。"
              actionLabel="＋ 提问"
              onAction={handleAsk}
            />
          ) : null}
          {!isLoading && error === null && items.length > 0 ? (
            <>
              <ul className="flex flex-col gap-3">
                {items.map((question) => (
                  <li key={question.id}>
                    <QuestionCard question={question} courseName={courseNameOf(question.course_id)} />
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-[12px] text-ink-subtle">共 {total} 条</p>
                <Pagination
                  page={page}
                  pageSize={pageSize}
                  total={total}
                  onChange={(next) => updateFilters({ page: next })}
                />
              </div>
            </>
          ) : null}
        </div>
        <aside className="min-w-0 lg:col-span-4">
          <RightRail />
        </aside>
      </div>
    </div>
  );
}
