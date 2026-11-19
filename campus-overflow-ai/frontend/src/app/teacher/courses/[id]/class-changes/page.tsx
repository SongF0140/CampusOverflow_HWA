import { ClassChangeView } from "@/features/teacher/ClassChangeView";

export default async function ClassChangesPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ request_id?: string }>;
}) {
  const { id } = await params;
  const { request_id } = await searchParams;
  if (!request_id || !/^[0-9a-f-]{36}$/i.test(request_id)) return <p>请从 Agent 提供的变更申请链接进入。</p>;
  return <ClassChangeView key={request_id} courseId={Number(id)} requestId={request_id} />;
}
