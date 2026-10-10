import { TagDetailView } from "@/features/tags/TagDetailView";
import { EmptyState } from "@/shared/components";

// 标签详情（页面控件级设计说明 §2.9）：Server Component 只解析参数，数据获取在客户端组件
export default async function TagDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { id } = await params;
  const { page } = await searchParams;

  const tagId = Number(id);
  if (!Number.isInteger(tagId) || tagId <= 0) {
    return (
      <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-8">
        <EmptyState
          title="标签不存在"
          description="标签链接可能有误，或该标签已被移除。"
        />
      </main>
    );
  }

  const parsedPage = Number.parseInt(page ?? "1", 10);
  const initialPage = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-8">
      <TagDetailView tagId={tagId} initialPage={initialPage} />
    </main>
  );
}
