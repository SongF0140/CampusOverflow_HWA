import { MePanel } from "@/features/me/MePanel";

// 个人中心（P-S10 / §2.12）：middleware 已守卫登录；Server 壳不取数，交互与数据在 MePanel（client）
export default function MePage() {
  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-8">
      <MePanel />
    </main>
  );
}
