"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ApiError } from "@/api/client";
import { register } from "@/api/auth";
import { Button } from "@/shared/components/Button";
import { Input } from "@/shared/components/Input";
import { Toast } from "@/shared/components/Toast";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type PasswordStrength = "weak" | "medium" | "strong";

// 简单强度：字符种类（小写/大写/数字/符号）+ 长度
export function getPasswordStrength(password: string): PasswordStrength | null {
  if (!password) return null;
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((pattern) =>
    pattern.test(password),
  ).length;
  if (password.length >= 10 && kinds >= 3) return "strong";
  if (kinds >= 2 || password.length >= 12) return "medium";
  return "weak";
}

const STRENGTH_META: Record<
  PasswordStrength,
  { label: string; filled: 1 | 2 | 3; barClass: string; textClass: string }
> = {
  weak: { label: "弱", filled: 1, barClass: "bg-warning", textClass: "text-warning-ink" },
  medium: { label: "中", filled: 2, barClass: "bg-warning", textClass: "text-warning-ink" },
  strong: { label: "强", filled: 3, barClass: "bg-brand", textClass: "text-brand" },
};

export function RegisterForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  // 逐字段校验：失焦与提交共用；返回是否全部通过
  function validateAll(): boolean {
    const trimmedUsername = username.trim();
    const nextUsernameError = !trimmedUsername
      ? "请输入用户名"
      : trimmedUsername.length < 3 || trimmedUsername.length > 20
        ? "用户名需 3~20 个字符"
        : null;
    const nextEmailError = !email.trim()
      ? "请输入邮箱"
      : EMAIL_PATTERN.test(email.trim())
        ? null
        : "请输入正确的邮箱地址";
    const nextPasswordError = !password ? "请输入密码" : password.length < 8 ? "密码至少 8 位" : null;
    const nextConfirmError = !confirm
      ? "请再次输入密码"
      : confirm === password
        ? null
        : "两次输入的密码不一致";
    setUsernameError(nextUsernameError);
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    setConfirmError(nextConfirmError);
    return (
      nextUsernameError === null &&
      nextEmailError === null &&
      nextPasswordError === null &&
      nextConfirmError === null
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!validateAll()) return;
    setPending(true);
    try {
      // 字段与后端 identity/schemas.py 的 UserRegisterRequest 一致（蛇形；注册默认学生角色）
      await register({ username: username.trim(), email: email.trim(), password });
      setSucceeded(true);
      // Toast 停留 1 秒再跳登录页，让用户看到"注册成功，请登录"
      window.setTimeout(() => router.push("/auth/login?registered=1"), 1000);
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : "服务暂时不可用，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  const strength = getPasswordStrength(password);
  const strengthMeta = strength ? STRENGTH_META[strength] : null;

  return (
    <div className="w-full max-w-[440px] rounded-lg border border-line bg-canvas p-8">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-soft text-[14px] font-semibold text-brand"
        >
          问
        </span>
        <span className="text-[15px] font-semibold text-ink">校园问答</span>
      </div>
      <h1 className="mt-3 text-[22px] font-semibold text-ink">注册校园问答账号</h1>
      <p className="mt-1 text-[13px] text-ink-muted">注册后即可参与提问与回答；教师账号由管理员统一分配。</p>

      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
        <Input
          label="用户名"
          name="username"
          value={username}
          autoComplete="username"
          placeholder="3~20 个字符"
          error={usernameError ?? undefined}
          onChange={(event) => setUsername(event.target.value)}
          onBlur={() =>
            setUsernameError(
              !username.trim()
                ? "请输入用户名"
                : username.trim().length < 3 || username.trim().length > 20
                  ? "用户名需 3~20 个字符"
                  : null,
            )
          }
        />

        <Input
          label="邮箱"
          name="email"
          type="email"
          value={email}
          autoComplete="email"
          placeholder="请输入邮箱，例如 xxx@example.com"
          error={emailError ?? undefined}
          onChange={(event) => setEmail(event.target.value)}
          onBlur={() =>
            setEmailError(
              !email.trim() ? "请输入邮箱" : EMAIL_PATTERN.test(email.trim()) ? null : "请输入正确的邮箱地址",
            )
          }
        />

        <div className="flex flex-col gap-1.5">
          <Input
            label="密码"
            name="password"
            type="password"
            value={password}
            autoComplete="new-password"
            placeholder="至少 8 位，含字母与数字更安全"
            error={passwordError ?? undefined}
            onChange={(event) => setPassword(event.target.value)}
            onBlur={() =>
              setPasswordError(!password ? "请输入密码" : password.length < 8 ? "密码至少 8 位" : null)
            }
          />
          {strengthMeta ? (
            <div className="flex items-center gap-2">
              <div className="flex flex-1 gap-1">
                {[1, 2, 3].map((segment) => (
                  <span
                    key={segment}
                    className={`h-1 flex-1 rounded-full ${
                      segment <= strengthMeta.filled ? strengthMeta.barClass : "bg-line"
                    }`}
                  />
                ))}
              </div>
              <span className={`text-[12px] ${strengthMeta.textClass}`}>{strengthMeta.label}</span>
            </div>
          ) : null}
        </div>

        <Input
          label="确认密码"
          name="confirmPassword"
          type="password"
          value={confirm}
          autoComplete="new-password"
          placeholder="再输入一次"
          error={confirmError ?? undefined}
          onChange={(event) => setConfirm(event.target.value)}
          onBlur={() =>
            setConfirmError(!confirm ? "请再次输入密码" : confirm === password ? null : "两次输入的密码不一致")
          }
        />

        {succeeded ? (
          <Toast tone="success" message="注册成功，请登录" />
        ) : formError ? (
          <p
            role="alert"
            className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger-ink"
          >
            {formError}
          </p>
        ) : null}

        <Button type="submit" isLoading={pending} disabled={succeeded} className="mt-1 w-full">
          {pending ? "注册中…" : "注册"}
        </Button>
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
