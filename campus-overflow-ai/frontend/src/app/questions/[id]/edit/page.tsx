import { TopNav } from "@/features/layout/TopNav";
import { EditQuestionForm } from "@/features/questions/EditQuestionForm";

export const metadata = { title: "编辑问题 · CampusOverflow" };

export default async function EditQuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="min-h-screen bg-panel">
      <TopNav />
      <main className="mx-auto max-w-[860px] px-8 py-6">
        <EditQuestionForm questionId={Number(id)} />
      </main>
    </div>
  );
}
