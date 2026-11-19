import { TrustedTagsView } from "@/features/teacher/TrustedTagsView";

export default async function TrustedTagsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TrustedTagsView key={id} courseId={Number(id)} />;
}
