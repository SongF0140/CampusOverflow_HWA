import { UserProfileView, type ProfileTab } from "@/features/users/UserProfileView";
import { EmptyState } from "@/shared/components";

// 默认 questions 不写入 URL（spec「用户域」）；非法值一律回退 questions
function normalizeTab(raw: string | string[] | undefined): ProfileTab {
  return raw === "answers" || raw === "hot" ? raw : "questions";
}

// 用户公开主页（P-S11 / §2.11）：只读公开信息（无邮箱/手机号）；
// Server 壳只解析路由与页签参数，数据获取在 UserProfileView（client）
export default async function UserPublicPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;

  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) {
    return (
      <main className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-8">
        <EmptyState
          title="用户不存在或链接有误"
          description="该用户链接可能已失效，回问题广场看看其他内容。"
        />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-8">
      <UserProfileView userId={userId} initialTab={normalizeTab(tab)} />
    </main>
  );
}
