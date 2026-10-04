import { QuestionDetailView } from "@/features/questions/QuestionDetailView";

export const metadata = { title: "问题详情 · CampusOverflow" };

export default async function QuestionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const [{ id }, { notice }] = await Promise.all([params, searchParams]);

  return (
    <main className="mx-auto max-w-[1280px] px-8 py-6">
      <QuestionDetailView questionId={Number(id)} notice={notice} />
    </main>
  );
}
