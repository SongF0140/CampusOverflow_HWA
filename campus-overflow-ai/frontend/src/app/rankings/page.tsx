import { TopNav } from "@/features/layout/TopNav";
import { RankingView } from "@/features/rankings/RankingView";
import { RANK_PERIODS, type RankPeriod } from "@/shared/constants/domain";

export const metadata = { title: "排行榜 · CampusOverflow" };

// 排行榜（P-S07）：period 与 course_id 走 URL 参数，便于回填与分享
export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; course_id?: string }>;
}) {
  const { period, course_id } = await searchParams;
  const courseId = Number(course_id);

  return (
    <div className="min-h-screen bg-panel">
      <TopNav />
      <main className="mx-auto max-w-[1280px] px-8 py-6">
        <RankingView
          initialPeriod={RANK_PERIODS.includes(period as RankPeriod) ? (period as RankPeriod) : undefined}
          initialCourseId={Number.isInteger(courseId) && courseId > 0 ? courseId : undefined}
        />
      </main>
    </div>
  );
}
