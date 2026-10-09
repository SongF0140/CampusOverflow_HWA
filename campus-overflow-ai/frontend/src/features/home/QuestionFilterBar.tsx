"use client";

import { Button, FilterBar, Select, TabNav } from "@/shared/components";
import type { Course } from "@/shared/types/course";
import type { QuestionSort } from "@/shared/types/question";
import type { TagListItem } from "@/shared/types/tag";

// 筛选状态（与 URL 参数一一对应：course_id/tag_id/sort/unresolved）
export interface QuestionFilters {
  courseId?: number;
  tagId?: number;
  sort: QuestionSort;
  unresolved: boolean;
}

export interface QuestionFilterBarProps {
  filters: QuestionFilters;
  courses: Course[];
  tags: TagListItem[];
  isTaxonomyLoading: boolean;
  // 变更回调：父级统一写入 URL（URL 为唯一筛选状态源）
  onChange: (patch: Partial<QuestionFilters>) => void;
  // ＋提问：登录 → /questions/new；游客 → /auth/login?returnTo=/questions/new（由父级分流）
  onAsk: () => void;
}

const SORT_TABS = [
  { key: "latest", label: "最新" },
  { key: "hot", label: "热门" },
];

const STATUS_TABS = [
  { key: "all", label: "全部" },
  { key: "unresolved", label: "未解决" },
];

// 问题广场筛选条（§2.3）：[＋提问] | 课程/标签 Select | 排序与状态 TabNav
export function QuestionFilterBar({
  filters,
  courses,
  tags,
  isTaxonomyLoading,
  onChange,
  onAsk,
}: QuestionFilterBarProps) {
  // TODO(接口差异)：后端 /api/questions 无 resolved 筛选参数，"已解决"Tab 随接口回填流程补
  return (
    <FilterBar
      actions={
        <Button onClick={onAsk}>
          <span aria-hidden="true">＋</span> 提问
        </Button>
      }
      filters={
        <>
          {/* Select 根节点自带 w-full，宽度用外层容器约束 */}
          <div className="w-[150px]">
            <Select
              aria-label="按课程筛选"
              value={filters.courseId ? String(filters.courseId) : ""}
              disabled={isTaxonomyLoading && courses.length === 0}
              onChange={(event) =>
                onChange({ courseId: event.target.value ? Number(event.target.value) : undefined })
              }
              options={[
                { value: "", label: "全部课程" },
                ...courses.map((course) => ({ value: String(course.id), label: course.name })),
              ]}
            />
          </div>
          <div className="w-[150px]">
            <Select
              aria-label="按标签筛选"
              value={filters.tagId ? String(filters.tagId) : ""}
              disabled={isTaxonomyLoading && tags.length === 0}
              onChange={(event) =>
                onChange({ tagId: event.target.value ? Number(event.target.value) : undefined })
              }
              options={[
                { value: "", label: "全部标签" },
                ...tags.map((tag) => ({ value: String(tag.id), label: tag.name })),
              ]}
            />
          </div>
          <TabNav
            tabs={SORT_TABS}
            active={filters.sort}
            onChange={(key) => onChange({ sort: key as QuestionSort })}
          />
          <TabNav
            tabs={STATUS_TABS}
            active={filters.unresolved ? "unresolved" : "all"}
            onChange={(key) => onChange({ unresolved: key === "unresolved" })}
          />
        </>
      }
    />
  );
}
