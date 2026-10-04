// 右栏数据源（演示用）：字段与真接口一致，接入时替换实现即可
// 真接口：GET /api/tags?hot=true&limit=10 → TagResponse；GET /api/reputation/rank?period=all → RankResponse
import type { RankRow } from "@/shared/types/reputation";
import type { TagListItem } from "@/shared/types/tag";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const HOT_TAGS: TagListItem[] = [
  { id: 1, name: "红黑树", type: "tech", question_count: 24 },
  { id: 3, name: "TCP", type: "tech", question_count: 19 },
  { id: 2, name: "进程", type: "tech", question_count: 17 },
  { id: 5, name: "哈希表", type: "tech", question_count: 12 },
  { id: 7, name: "子网划分", type: "tech", question_count: 9 },
  { id: 6, name: "作业三", type: "course", question_count: 6 },
];

const RANK_ROWS: RankRow[] = [
  { user_id: 11, username: "赵同学", score: 320 },
  { user_id: 12, username: "王同学", score: 285 },
  { user_id: 13, username: "李同学", score: 240 },
  { user_id: 14, username: "孙同学", score: 176 },
  { user_id: 15, username: "吴同学", score: 132 },
];

export async function fetchHotTags(): Promise<TagListItem[]> {
  await delay(300);
  return HOT_TAGS;
}

export async function fetchRanking(): Promise<RankRow[]> {
  await delay(300);
  return RANK_ROWS;
}
