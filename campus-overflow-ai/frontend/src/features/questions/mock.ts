// 问题广场的临时数据源：字段与真接口一致，接入真接口时只需替换 fetchQuestionList 的实现
// 真接口：GET /api/questions?page=&page_size=&course_id=&tag_id=&sort=latest|hot&unresolved=&keyword=
import type { QuestionListParams, QuestionListItem, QuestionListResult } from "@/shared/types/question";

const COURSES: Record<number, string> = {
  1: "数据结构",
  2: "操作系统",
  3: "计算机网络",
};

export function courseName(courseId: number): string {
  return COURSES[courseId] ?? `课程 ${courseId}`;
}

const MOCK_QUESTIONS: QuestionListItem[] = [
  {
    id: 101,
    title: "红黑树的删除操作为什么要分四种情况讨论？",
    course_id: 1,
      author: "李同学",
      tags: [{ id: 1, name: "红黑树", type: "tech" }],
      status: "published",
    vote_score: 12,
    my_vote: 0,
    answer_count: 3,
    view_count: 218,
    has_accepted: false,
    created_at: "2026-10-03T09:12:00+08:00",
  },
  {
    id: 102,
    title: "进程和线程在地址空间上的区别，可以举一个具体例子吗？",
    course_id: 2,
    author: "王同学",
    tags: [{ id: 2, name: "进程", type: "tech" }],
    status: "resolved",
    vote_score: 31,
    my_vote: 0,
    answer_count: 5,
    view_count: 604,
    has_accepted: true,
    created_at: "2026-10-02T20:40:00+08:00",
  },
  {
    id: 103,
    title: "TCP 三次握手为什么不能改成两次？",
    course_id: 3,
    author: "赵同学",
    tags: [
      { id: 3, name: "TCP", type: "tech" },
      { id: 4, name: "面试高频", type: "custom" },
    ],
    status: "resolved",
    vote_score: 47,
    my_vote: 1,
    answer_count: 8,
    view_count: 1520,
    has_accepted: true,
    created_at: "2026-10-02T14:05:00+08:00",
  },
  {
    id: 104,
    title: "为什么哈希表扩容要选择 2 的幂次大小？",
    course_id: 1,
      author: "孙同学",
      tags: [{ id: 5, name: "哈希表", type: "tech" }],
      status: "published",
    vote_score: 6,
    my_vote: 0,
    answer_count: 1,
    view_count: 96,
    has_accepted: false,
    created_at: "2026-10-01T22:31:00+08:00",
  },
  {
    id: 105,
    title: "作业三第 4 题的动态规划状态转移怎么推导？",
    course_id: 2,
      author: "周同学",
      tags: [{ id: 6, name: "作业三", type: "course" }],
      status: "published",
    vote_score: 2,
    my_vote: -1,
    answer_count: 0,
    view_count: 41,
    has_accepted: false,
    created_at: "2026-10-01T19:02:00+08:00",
  },
  {
    id: 106,
    title: "子网掩码和 CIDR 的表示法怎么互相换算？",
    course_id: 3,
      author: "吴同学",
      tags: [{ id: 7, name: "子网划分", type: "tech" }],
      status: "published",
    vote_score: 9,
    my_vote: 0,
    answer_count: 2,
    view_count: 173,
    has_accepted: false,
    created_at: "2026-09-30T11:20:00+08:00",
  },
];

// 模拟网络往返：让加载态（骨架屏）在开发时可见
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchQuestionList(params: QuestionListParams = {}): Promise<QuestionListResult> {
  await delay(450);

  const {
    page = 1,
    page_size = 20,
    course_id,
    tag_id,
    sort = "latest",
    unresolved = false,
    keyword,
  } = params;

  let items = [...MOCK_QUESTIONS];
  if (course_id) items = items.filter((item) => item.course_id === course_id);
  if (tag_id) items = items.filter((item) => item.tags.some((tag) => tag.id === tag_id));
  if (unresolved) items = items.filter((item) => item.status !== "resolved");
  if (keyword?.trim()) {
    const kw = keyword.trim().toLowerCase();
    items = items.filter((item) => item.title.toLowerCase().includes(kw));
  }
  items =
    sort === "hot"
      ? items.sort((a, b) => b.vote_score - a.vote_score)
      : items.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

  const start = (page - 1) * page_size;
  return {
    items: items.slice(start, start + page_size),
    total: items.length,
    page,
    page_size,
  };
}

export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}
