import { EditQuestionPanel } from "@/features/questions/EditQuestionPanel";
import { QuestionMissing } from "@/features/questions/QuestionDetailView";

// 编辑问题（P-S08 / 页面控件级设计说明 §2.8）
// 登录守卫由 middleware 承担；作者判定在面板内做（后端 PATCH 仅作者放行）
export default async function EditQuestionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const questionId = Number(id);
  if (!Number.isInteger(questionId) || questionId <= 0) {
    return (
      <main className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-8">
        <QuestionMissing />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-8">
      <EditQuestionPanel questionId={questionId} />
    </main>
  );
}
