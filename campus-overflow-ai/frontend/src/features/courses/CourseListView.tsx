"use client";

import { useCallback, useState, type FormEvent } from "react";

import { listCourses } from "@/api/courses";
import { ApiError } from "@/api/client";
import {
  EmptyState,
  ErrorState,
  Input,
  LoadingSkeleton,
  Pagination,
  Select,
} from "@/shared/components";
import { usePagedList } from "@/shared/hooks/usePagedList";
import { redirectToLogin } from "@/shared/utils/navigation";
import type { Course, CourseListParams } from "@/shared/types/course";

import { CourseCard } from "./CourseCard";
import { collectSemesters } from "./courseFields";

// 401 哨兵错误：usePagedList 只透出错误文案，用固定串识别"游客需登录"
const LOGIN_REQUIRED_MESSAGE = "登录后查看课程";

class LoginRequiredError extends Error {
  constructor() {
    super(LOGIN_REQUIRED_MESSAGE);
    this.name = "LoginRequiredError";
  }
}

const ALL_SEMESTER = { value: "", label: "全部学期" };

// 课程列表（页面控件级设计说明 §2.4）：学期 Select + 搜索 Input + 3 列课程卡网格
// 搜索走后端 GET /courses 的 keyword 参数（名称/编码模糊），不做前端过滤
export function CourseListView() {
  const [keywordDraft, setKeywordDraft] = useState("");
  const [semester, setSemester] = useState("");

  // 401（游客）转成哨兵错误，其余原样抛出由 toErrorMessage 转中文
  const fetchPage = useCallback(
    async (query: CourseListParams & { page: number; page_size: number }) => {
      try {
        return await listCourses(query);
      } catch (caught) {
        if (caught instanceof ApiError && caught.isUnauthorized) throw new LoginRequiredError();
        throw caught;
      }
    },
    [],
  );
  const list = usePagedList<Course, CourseListParams>(fetchPage, {});

  // 学期选项从当前页课程数据聚合去重；响应暂无 semester 字段时只有"全部学期"
  const semesterOptions = [
    ALL_SEMESTER,
    ...collectSemesters(list.items).map((item) => ({ value: item, label: item })),
  ];

  function applyKeyword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    list.setParams({ keyword: keywordDraft.trim() || undefined, semester: semester || undefined });
  }

  function handleSemesterChange(next: string) {
    setSemester(next);
    list.setParams({ keyword: keywordDraft.trim() || undefined, semester: next || undefined });
  }

  function clearFilters() {
    setKeywordDraft("");
    setSemester("");
    list.setParams({ keyword: undefined, semester: undefined });
  }

  const hasFilters = keywordDraft.trim().length > 0 || semester.length > 0;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[22px] font-semibold text-ink">课程</h1>
        <div className="flex flex-wrap items-center gap-2">
          {/* 学期筛选走后端 semester 精确参数；选项暂无法从响应聚合时仅剩"全部学期" */}
          <Select
            aria-label="按学期筛选"
            options={semesterOptions}
            value={semester}
            onChange={(event) => handleSemesterChange(event.target.value)}
            className="h-9 w-[150px]"
          />
          <form role="search" aria-label="课程搜索" onSubmit={applyKeyword}>
            <Input
              value={keywordDraft}
              onChange={(event) => setKeywordDraft(event.target.value)}
              placeholder="搜索课程名 / 编码，回车触发"
              aria-label="搜索课程"
              className="h-9 w-[260px]"
            />
          </form>
        </div>
      </div>

      {list.error === LOGIN_REQUIRED_MESSAGE ? (
        <EmptyState
          title="登录后查看课程"
          description="课程列表仅对登录用户可见，登录后可浏览并加入课程。"
          actionLabel="去登录"
          onAction={() => redirectToLogin("/courses")}
        />
      ) : null}

      {list.error !== null && list.error !== LOGIN_REQUIRED_MESSAGE ? (
        <ErrorState message={list.error} onRetry={list.reload} />
      ) : null}

      {list.isLoading ? <LoadingSkeleton variant="card" count={6} /> : null}

      {!list.isLoading && list.error === null && list.items.length === 0 ? (
        hasFilters ? (
          <EmptyState
            title="没有找到符合条件的课程"
            description="换个关键词或学期再试一次。"
            actionLabel="清除筛选"
            onAction={clearFilters}
          />
        ) : (
          <EmptyState
            title="暂无课程"
            description="课程由教师创建后会展示在这里，届时可浏览并加入。"
          />
        )
      ) : null}

      {!list.isLoading && list.error === null && list.items.length > 0 ? (
        <>
          {/* 3 列网格，≤1024 降 2 列 / 1 列（设计说明 §0.1 断点） */}
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 min-[1025px]:grid-cols-3">
            {list.items.map((course) => (
              <li key={course.id}>
                <CourseCard course={course} />
              </li>
            ))}
          </ul>
          {list.total > list.pageSize ? (
            <div className="flex justify-center">
              <Pagination
                page={list.page}
                pageSize={list.pageSize}
                total={list.total}
                onChange={list.setPage}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
