import { ExperienceReviewView } from "@/features/teacher/ExperienceReviewView";

export const metadata = { title: "回答流程经验 · CampusOverflow" };

export default async function TeacherExperiencesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ExperienceReviewView courseId={Number(id)} />;
}
