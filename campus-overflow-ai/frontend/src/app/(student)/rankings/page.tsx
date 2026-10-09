import { RankingsView, type RankingTab } from "@/features/rankings/RankingsView";

function parseCourseId(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

// 排行榜（页面控件级设计说明 §2.10）：Server Component 只解析参数，数据获取在客户端组件
// URL 契约与后端 /reputation/rank 对齐（period 仅接受 week|month|all）：
// 周榜为默认不写参数；月榜 ?period=month；课程榜 ?period=all&course_id=N
export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; course_id?: string }>;
}) {
  const { period, course_id } = await searchParams;

  const courseId = parseCourseId(course_id);
  let initialTab: RankingTab = "week";
  if (courseId !== null) {
    initialTab = "course";
  } else if (period === "month") {
    initialTab = "month";
  }

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-8">
      <RankingsView initialTab={initialTab} initialCourseId={courseId} />
    </main>
  );
}
