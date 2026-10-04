"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, type FormEvent } from "react";

import { ApiError } from "@/api/client";
import { homePathFor, useSessionStore } from "@/shared/stores/session-store";
import { toInternalPath } from "@/shared/utils/redirect";

const inputClass =
  "co-focusable h-11 w-full rounded-md border border-line bg-canvas px-3 text-[14px] text-ink transition-colors duration-150 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20";

export function LoginForm({ returnTo }: { returnTo?: string }) {
  const router = useRouter();
  const signIn = useSessionStore((state) => state.signIn);
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account.trim() || !password) {
      setError("请输入用户名/邮箱和密码");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const user = await signIn(account.trim(), password);
      router.replace(toInternalPath(returnTo) ?? homePathFor(user.role));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "服务暂时不可用，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="w-full max-w-[400px] rounded-lg border border-line bg-canvas p-8">
      <h1 className="text-[24px] font-semibold text-ink">登录 CampusOverflow</h1>
      <p className="mt-1 text-[13px] text-ink-muted">用用户名或邮箱登录，进入你所在的端。</p>

      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">用户名或邮箱</span>
          <input
            className={inputClass}
            name="account"
            value={account}
            autoComplete="username"
            placeholder="请输入用户名或邮箱"
            onChange={(event) => setAccount(event.target.value)}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">密码</span>
          <input
            className={inputClass}
            name="password"
            type="password"
            value={password}
            autoComplete="current-password"
            placeholder="请输入密码"
            onChange={(event) => setPassword(event.target.value)}
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
          {pending ? "登录中…" : "登录"}
        </button>
      </form>

      <p className="mt-6 text-[13px] text-ink-muted">
        还没有账号？
        <Link href="/auth/register" className="co-focusable ml-1 text-brand underline underline-offset-2">
          注册
        </Link>
      </p>
    </div>
  );
}
