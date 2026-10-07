"use client";

import { useEffect, useState, type FormEvent } from "react";

import { ApiError } from "@/api/client";
import { updateMe } from "@/api/users";
import { ErrorState, LoadingSkeleton } from "@/shared/components";
import { USER_ROLE_LABEL } from "@/shared/constants/domain";
import { useSessionStore } from "@/shared/stores/session-store";

// 与后端 identity/schemas.py UserUpdateRequest 的上限一致
const BIO_MAX_LEN = 500;
const AVATAR_URL_MAX_LEN = 255;

const inputClass =
  "co-focusable w-full rounded-md border border-line bg-canvas px-3 py-2 text-[14px] text-ink transition-colors duration-150 ease-standard placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand focus:ring-2 focus:ring-brand/20";

export function ProfileForm() {
  const me = useSessionStore((state) => state.me);
  const status = useSessionStore((state) => state.status);
  const loadMe = useSessionStore((state) => state.loadMe);
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  // 资料就绪后预填一次（之后由用户输入控制，不再覆盖）
  useEffect(() => {
    if (!me || initialized) return;
    void (async () => {
      await Promise.resolve();
      setBio(me.bio ?? "");
      setAvatarUrl(me.avatar_url ?? "");
      setInitialized(true);
    })();
  }, [me, initialized]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (bio.length > BIO_MAX_LEN) {
      setError(`个人简介不能超过 ${BIO_MAX_LEN} 字`);
      return;
    }
    if (avatarUrl.length > AVATAR_URL_MAX_LEN) {
      setError(`头像地址不能超过 ${AVATAR_URL_MAX_LEN} 字符`);
      return;
    }
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      await updateMe({ bio, avatar_url: avatarUrl });
      await loadMe(); // 刷新内存里的登录态，顶栏用户名/资料同步更新
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "保存失败，请稍后重试");
    } finally {
      setPending(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-[760px] px-8 py-6">
        <LoadingSkeleton variant="detail" count={2} />
      </div>
    );
  }

  if (!me) {
    return (
      <div className="mx-auto max-w-[760px] px-8 py-6">
        <ErrorState message="登录态已失效，请重新登录。" />
      </div>
    );
  }

  return (
    <section className="mx-auto flex max-w-[760px] flex-col gap-4 px-8 py-6">
      <h1 className="text-[22px] font-semibold text-ink">个人中心</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5 rounded-lg border border-line bg-canvas p-6">
        <div className="grid grid-cols-2 gap-3 text-[13px]">
          <p className="text-ink-muted">
            用户名：<span className="text-ink">{me.username}</span>
          </p>
          <p className="text-ink-muted">
            角色：<span className="text-ink">{USER_ROLE_LABEL[me.role] ?? me.role}</span>
          </p>
          <p className="text-ink-muted">
            邮箱：<span className="text-ink">{me.email}</span>
          </p>
          <p className="text-ink-muted">
            声誉：<span className="text-ink">{me.reputation_score}</span>
          </p>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">
            个人简介
            <span className="ml-2 text-[12px] text-ink-subtle">
              {bio.length}/{BIO_MAX_LEN}
            </span>
          </span>
          <textarea
            value={bio}
            onChange={(event) => setBio(event.target.value)}
            rows={4}
            maxLength={BIO_MAX_LEN}
            placeholder="介绍一下你自己，比如擅长的课程方向"
            className={`${inputClass} resize-y leading-relaxed`}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink">头像地址（可选）</span>
          <input
            value={avatarUrl}
            onChange={(event) => setAvatarUrl(event.target.value)}
            maxLength={AVATAR_URL_MAX_LEN}
            placeholder="例如 https://example.com/avatar.png"
            className={`${inputClass} h-11`}
          />
        </label>

        {error ? (
          <p role="alert" className="rounded-md border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger-ink">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="rounded-md border border-success/40 bg-success-soft px-3 py-2 text-[13px] text-success-ink">
            资料已保存
          </p>
        ) : null}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            className="co-focusable cursor-pointer rounded-md bg-brand px-4 py-2 text-[14px] font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-strong disabled:cursor-not-allowed disabled:bg-line disabled:text-ink-subtle"
          >
            {pending ? "保存中…" : "保存资料"}
          </button>
        </div>
      </form>
    </section>
  );
}
