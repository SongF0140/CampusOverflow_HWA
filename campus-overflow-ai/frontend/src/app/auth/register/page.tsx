import { RegisterForm } from "@/features/auth/RegisterForm";

export const metadata = { title: "注册 · CampusOverflow" };

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-panel px-6 py-10">
      <RegisterForm />
    </main>
  );
}
