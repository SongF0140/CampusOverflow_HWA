import { KnowledgeView } from "@/features/teacher/KnowledgeView";

export const metadata = { title: "知识树与教学周报 · CampusOverflow" };

// 教师知识树工作台（KN-R01~03，K-05）：知识树 / 教学计划 / 周报三区块
// 权限：知识树随课程读取；教学计划与周报仅负责教师（后端 E-14 二次校验）
export default async function TeacherKnowledgePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <KnowledgeView courseId={Number(id)} />;
}
