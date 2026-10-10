import { LoginForm } from "@/features/auth/LoginForm";

export const metadata = { title: "登录 · CampusOverflow" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; registered?: string }>;
}) {
  const { returnTo, registered } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-panel px-6 py-10">
      <div className="flex w-full max-w-[400px] flex-col gap-4">
        {registered ? (
          <p className="rounded-md border border-success/40 bg-success-soft px-3 py-2 text-[13px] text-success-ink">
            注册成功，请使用新账号登录。
          </p>
        ) : null}
        <LoginForm returnTo={returnTo} />
      </div>
    </main>
  );
}
