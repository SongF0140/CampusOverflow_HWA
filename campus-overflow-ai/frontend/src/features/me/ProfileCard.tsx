"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { updateMe } from "@/api/users";
import {
  Avatar,
  Button,
  Input,
  Textarea,
  Toast,
  type ToastTone,
} from "@/shared/components";
import { toErrorMessage } from "@/shared/hooks/useAsyncData";
import { useSessionStore } from "@/shared/stores/session-store";
import type { UserMe } from "@/shared/types/auth";

interface ToastState {
  tone: ToastTone;
  message: string;
}

// 快捷入口（§2.12）：通知中心恒显示；AI 记忆整页暂缓置灰；封禁申诉仅封禁态显示
function QuickEntries({ isBanned }: { isBanned: boolean }) {
  return (
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="text-[13px] font-medium text-ink-muted">快捷入口</h3>
      <ul className="mt-2 flex flex-col gap-1">
        <li>
          <Link
            href="/notifications"
            className="co-focusable flex items-center justify-between rounded-md px-2 py-2 text-[14px] text-ink transition-colors duration-150 ease-standard hover:bg-panel hover:text-brand"
          >
            通知中心
            <span aria-hidden="true" className="text-ink-subtle">
              →
            </span>
          </Link>
        </li>
        <li>
          {/* TODO(AI 二期)：接入 /me/memories 记忆列表后启用入口（设计说明 §2.13 整页暂缓） */}
          <button
            type="button"
            disabled
            title="随 AI 功能开放"
            className="flex w-full cursor-not-allowed items-center justify-between rounded-md px-2 py-2 text-[14px] text-ink-subtle opacity-60"
          >
            我的 AI 记忆
            <span aria-hidden="true">→</span>
          </button>
        </li>
        {isBanned ? (
          <li>
            <Link
              href="/appeals/new"
              className="co-focusable flex items-center justify-between rounded-md px-2 py-2 text-[14px] text-danger transition-colors duration-150 ease-standard hover:bg-danger-soft"
            >
              封禁申诉
              <span aria-hidden="true" className="text-ink-subtle">
                →
              </span>
            </Link>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

// 资料卡（§2.12 左 5 列）：头像 + 昵称/简介编辑 + 保存 + 快捷入口
// 保存成功后经 loadMe 同步 session-store 的 me，顶栏昵称立即联动
export function ProfileCard({ me }: { me: UserMe }) {
  const loadMe = useSessionStore((state) => state.loadMe);

  const [nickname, setNickname] = useState(me.username);
  const [bio, setBio] = useState(me.bio ?? "");
  const [nicknameError, setNicknameError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  // Toast 自动消失：倒计时回调里 setState，不在 effect 同步路径上
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function handleNicknameChange(value: string) {
    setNickname(value);
    if (nicknameError) setNicknameError("");
  }

  async function handleSave() {
    const trimmedNickname = nickname.trim();
    // 空昵称行内拦截：不发请求
    if (!trimmedNickname) {
      setNicknameError("昵称不能为空");
      return;
    }
    setIsSaving(true);
    try {
      await updateMe({
        username: trimmedNickname,
        bio: bio === "" ? null : bio,
      });
      setToast({ tone: "success", message: "资料已保存" });
      await loadMe();
    } catch (caught) {
      setToast({ tone: "error", message: toErrorMessage(caught) });
    } finally {
      setIsSaving(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void handleSave();
  }

  return (
    <section className="rounded-lg border border-line bg-canvas p-5">
      {toast ? (
        <div className="fixed left-1/2 top-20 z-50 w-[min(90vw,360px)] -translate-x-1/2">
          <Toast tone={toast.tone} message={toast.message} onClose={() => setToast(null)} />
        </div>
      ) : null}

      <h2 className="text-[16px] font-semibold text-ink">我的资料</h2>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
        {/* TODO(二期)：头像上传/预览（后端暂无文件上传接口），本期仅展示头像 */}
        <div className="flex items-center gap-4">
          <Avatar name={me.username} src={me.avatar_url ?? undefined} size="lg" />
          <Button variant="ghost" disabled title="头像上传即将开放">
            上传头像
          </Button>
        </div>

        <Input
          label="昵称"
          value={nickname}
          onChange={(event) => handleNicknameChange(event.target.value)}
          error={nicknameError || undefined}
          maxLength={50}
        />
        <Textarea
          label="简介"
          value={bio}
          onChange={(event) => setBio(event.target.value)}
          rows={4}
          maxLength={500}
          hint="最多 500 字"
        />
        <div>
          <Button type="submit" isLoading={isSaving}>
            保存
          </Button>
        </div>
      </form>

      <QuickEntries isBanned={me.status === "banned"} />
    </section>
  );
}
