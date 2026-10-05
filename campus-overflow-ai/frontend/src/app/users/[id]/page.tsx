import { TopNav } from "@/features/layout/TopNav";
import { PublicProfileView } from "@/features/users/PublicProfileView";

export const metadata = { title: "用户主页 · CampusOverflow" };

export default async function UserProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="min-h-screen bg-panel">
      <TopNav />
      <main>
        <PublicProfileView userId={Number(id)} />
      </main>
    </div>
  );
}
