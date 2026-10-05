"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ApiError } from "@/api/client";
import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";
import { homePathFor, useSessionStore } from "@/shared/stores/session-store";
import { toInternalPath } from "@/shared/utils/redirect";

const inputClass =
  "co-focusable h-11 w-full rounded-md border border-line bg-canvas px-3 text-[14px] text-ink transition-colors duration-150 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20";

export function LoginForm({ returnTo }: { returnTo?: string }) {
  const router = useRouter();
  const signIn = useSessionStore((state) => state.signIn);
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // 非空校验：失焦与提交共用；返回是否全部通过
  function validatePresence(): boolean {
    const nextAccountError = account.trim() ? null : "请输入账号";
    const nextPasswordError = password ? null : "请输入密码";
    setAccountError(nextAccountError);
    setPasswordError(nextPasswordError);
    return nextAccountError === null && nextPasswordError === null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!validatePresence()) return;
    setPending(true);
    try {
      const user = await signIn(account.trim(), password);
      // 有站内 returnTo 回跳原路径，否则按角色分流到对应端首页
      router.replace(toInternalPath(returnTo) ?? homePathFor(user.role));
    } catch (caught) {
      if (caught instanceof ApiError) {
        // 401 固定文案，不区分"账号不存在/密码错误"，避免账号枚举；其余透传后端中文 message
        setFormError(caught.code === 401 ? "账号或密码不正确" : caught.message);
      } else {
        setFormError("服务暂时不可用，请稍后重试");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="w-full max-w-[400px] rounded-lg border border-line bg-canvas p-8">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-soft text-[14px] font-semibold text-brand"
        >
          问
        </span>
        <span className="text-[15px] font-semibold text-ink">校园问答</span>
      </div>
      <h1 className="mt-3 text-[22px] font-semibold text-ink">欢迎回到校园问答</h1>
      <p className="mt-1 text-[13px] text-ink-muted">用邮箱或用户名登录，继续你的提问与回答。</p>

      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <Input
          label="账号"
          name="account"
          value={account}
          autoComplete="username"
          placeholder="邮箱或用户名"
          error={accountError ?? undefined}
          onChange={(event) => setAccount(event.target.value)}
          onBlur={() => setAccountError(account.trim() ? null : "请输入账号")}
        />

        <div className="relative">
          <Input
            label="密码"
            name="password"
            type={isPasswordVisible ? "text" : "password"}
            value={password}
            autoComplete="current-password"
            placeholder="请输入密码"
            className="pr-10"
            error={passwordError ?? undefined}
            onChange={(event) => setPassword(event.target.value)}
            onBlur={() => setPasswordError(password ? null : "请输入密码")}
          />
          <button
            type="button"
            aria-label={isPasswordVisible ? "隐藏密码" : "显示密码"}
            onClick={() => setIsPasswordVisible((visible) => !visible)}
            className="co-focusable absolute right-2 top-[33px] cursor-pointer rounded p-1 text-[14px] leading-none text-ink-subtle transition-colors duration-150 ease-standard hover:text-ink"
          >
            👁
          </button>
        </div>

        {formError ? (
          <p
            role="alert"
            className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger-ink"
          >
            {formError}
          </p>
        ) : null}

        <Button type="submit" isLoading={pending} className="mt-1 w-full">
          {pending ? "登录中…" : "登录"}
        </Button>
      </form>

      <p className="mt-6 text-[13px] text-ink-muted">
        没有账号？
        <Link href="/auth/register" className="co-focusable ml-1 text-brand underline underline-offset-2">
          去注册
        </Link>
      </p>
    </div>
  );
}
