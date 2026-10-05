import { TopNav } from "@/features/layout/TopNav";
import { ProfileForm } from "@/features/users/ProfileForm";

export const metadata = { title: "个人中心 · CampusOverflow" };

// 学生端页面统一形态：顶栏 + 内容区；入口来自顶栏用户名
export default function MePage() {
  return (
    <div className="min-h-screen bg-panel">
      <TopNav />
      <main>
        <ProfileForm />
      </main>
    </div>
  );
}
