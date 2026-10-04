"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { ApiError } from "@/api/client";
import { register } from "@/api/auth";

const inputClass =
  "co-focusable h-11 w-full rounded-md border border-line bg-canvas px-3 text-[14px] text-ink transition-colors duration-150 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20";

export function RegisterForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // 提交前本地校验：不发请求（前端服务需求文档 §3.5）
  function validate(): string | null {
    if (username.trim().length < 3) return "用户名至少 3 个字符";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "请输入正确的邮箱地址";
    if (password.length < 6) return "密码至少 6 位";
    if (password !== confirm) return "两次输入的密码不一致";
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const localError = validate();
    if (localError) {
      setError(localError);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await register({ username: username.trim(), email: email.trim(), password });
      router.replace("/auth/login?registered=1");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "服务暂时不可用，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="w-full max-w-[400px] rounded-lg border border-line bg-canvas p-8">
      <h1 className="text-[24px] font-semibold text-ink">注册学生账号</h1>
      <p className="mt-1 text-[13px] text-ink-muted">教师与管理账号由管理员分配，不开放自助注册。</p>

      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">用户名</span>
          <input
            className={inputClass}
            value={username}
            autoComplete="username"
            placeholder="3–50 个字符"
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">邮箱</span>
          <input
            className={inputClass}
            type="email"
            value={email}
            autoComplete="email"
            placeholder="you@example.com"
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">密码</span>
          <input
            className={inputClass}
            type="password"
            value={password}
            autoComplete="new-password"
            placeholder="至少 6 位"
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">确认密码</span>
          <input
            className={inputClass}
            type="password"
            value={confirm}
            autoComplete="new-password"
            placeholder="再输入一次"
            onChange={(event) => setConfirm(event.target.value)}
          />
        </label>

        {error ? (
          <p role="alert" className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger-ink">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          className="co-focusable mt-1 h-11 cursor-pointer rounded-md bg-brand text-[14px] font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-subtle"
        >
          {pending ? "提交中…" : "注册"}
        </button>
      </form>

      <p className="mt-6 text-[13px] text-ink-muted">
        已有账号？
        <Link href="/auth/login" className="co-focusable ml-1 text-brand underline underline-offset-2">
          去登录
        </Link>
      </p>
    </div>
  );
}
