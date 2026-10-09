import { QuestionDetailView, QuestionMissing } from "@/features/questions/QuestionDetailView";
import type { AnswerSort } from "@/shared/types/answer";

// 问题详情（P-S07 / 页面控件级设计说明 §2.7，核心页）
// sort 由回答区排序写入 URL（latest 为默认不写入），刷新后由服务端解析回填
export default async function QuestionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sort?: string }>;
}) {
  const { id } = await params;
  const { sort } = await searchParams;

  const questionId = Number(id);
  if (!Number.isInteger(questionId) || questionId <= 0) {
    return (
      <main className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-8">
        <QuestionMissing />
      </main>
    );
  }

  const initialSort: AnswerSort = sort === "votes" ? "votes" : "latest";

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-8">
      <QuestionDetailView questionId={questionId} initialSort={initialSort} />
    </main>
  );
}
