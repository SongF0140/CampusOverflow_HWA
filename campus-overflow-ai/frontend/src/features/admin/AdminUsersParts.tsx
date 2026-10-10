"use client";

import { useState } from "react";

import {
  Button,
  Drawer,
  Select,
  StateBadge,
  Textarea,
  UserLine,
  type SelectOption,
} from "@/shared/components";
import type { UserRole } from "@/shared/types/auth";
import type { PublicUser } from "@/shared/types/user";

/**
 * 用户管理行数据：管理员列表接口返回 PublicUser（后端暂无 ban_reason），
 * 封禁原因展示依赖可选字段，后端补字段后无需再改。
 */
export type AdminUserRow = PublicUser & { ban_reason?: string | null };

// 角色中文文案（§4.2：student/teacher/admin → 学生/教师/管理员文本徽标）
export const ROLE_LABELS: Record<UserRole, string> = {
  student: "学生",
  teacher: "教师",
  admin: "管理员",
};

const ROLE_BADGE_CLASS: Record<UserRole, string> = {
  student: "bg-panel text-ink-muted",
  teacher: "bg-brand-soft text-brand-strong",
  admin: "bg-danger-soft text-danger-ink",
};

const REASON_OPTIONS: SelectOption[] = [
  { value: "违规发帖", label: "违规发帖" },
  { value: "恶意行为", label: "恶意行为" },
  { value: "其他", label: "其他" },
];


// ISO 串直接截取日期部分展示，避免时区换算导致日期偏移
export function formatRegisteredDate(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : iso;
}

// 用户表（§4.2）：用户 · 角色 · 状态（封禁行展示原因小字）· 声望 · 注册时间 · 操作
export function AdminUsersTable({
  users,
  onBan,
  onUnban,
}: {
  users: AdminUserRow[];
  onBan: (user: AdminUserRow) => void;
  onUnban: (user: AdminUserRow) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-canvas">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line text-[12px] text-ink-subtle">
            <th scope="col" className="py-3 pl-5 pr-4 font-medium">用户</th>
            <th scope="col" className="py-3 pr-4 font-medium">角色</th>
            <th scope="col" className="py-3 pr-4 font-medium">状态</th>
            <th scope="col" className="py-3 pr-4 font-medium">声望</th>
            <th scope="col" className="py-3 pr-4 font-medium">注册时间</th>
            <th scope="col" className="py-3 pr-4 font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {/* 表行高度按控件设计 §0.2 取 64px 下限 */}
          {users.map((user) => (
            <tr key={user.id} className="h-16 border-b border-line last:border-b-0">
              <td className="py-3 pl-5 pr-4">
                <UserLine
                  userId={user.id}
                  nickname={user.username}
                  role={user.role}
                  avatarSrc={user.avatar_url ?? undefined}
                  size="sm"
                />
              </td>
              <td className="py-3 pr-4">
                <span
                  className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[11px] font-medium ${ROLE_BADGE_CLASS[user.role]}`}
                >
                  {ROLE_LABELS[user.role]}
                </span>
              </td>
              <td className="py-3 pr-4">
                <StateBadge
                  tone={user.status === "banned" ? "banned" : "resolved"}
                  label={user.status === "banned" ? "已封禁" : "正常"}
                />
                {user.status === "banned" && user.ban_reason ? (
                  <p className="mt-1 text-[12px] text-danger-ink">{user.ban_reason}</p>
                ) : null}
              </td>
              <td className="py-3 pr-4 text-[13px] text-ink-muted">{user.reputation_score}</td>
              <td className="py-3 pr-4 text-[13px] text-ink-muted">
                {formatRegisteredDate(user.created_at)}
              </td>
              <td className="py-3 pr-4">
                {/* 操作条件渲染：已封禁 → 解禁，否则 → 封禁（§4.2） */}
                {user.status === "banned" ? (
                  <Button variant="ghost" onClick={() => onUnban(user)}>
                    解禁
                  </Button>
                ) : user.role !== "admin" ? (
                  <Button variant="ghost" onClick={() => onBan(user)}>
                    封禁
                  </Button>
                ) : <span className="text-[12px] text-ink-subtle">管理员不可封禁</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 封禁 Drawer（§4.2：右侧滑出 400px）：原因 Select 必填 + 补充说明 Textarea + 封禁时长 Select
// 仅在选中封禁目标时由父级挂载，表单状态随挂载自然重置
export function BanDrawer({
  user,
  submitting,
  onSubmit,
  onClose,
}: {
  user: AdminUserRow;
  submitting: boolean;
  onSubmit: (reason: string, note: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  function handleSubmit() {
    // 原因必填行内校验：未选择时拦截提交
    if (reason === "") {
      setReasonError("请选择封禁原因");
      return;
    }
    if ((note.trim() ? `${reason}（${note.trim()}）` : reason).length > 200) {
      setReasonError("封禁原因与说明合计不能超过 200 字");
      return;
    }
    setReasonError(null);
    onSubmit(reason, note.trim());
  }

  return (
    <Drawer
      open
      onClose={onClose}
      // 提交中锁死关闭路径：封禁请求不可取消，中途关掉再开另一个用户会造成并行改状态
      dismissible={!submitting}
      title={`封禁用户 · ${user.username}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button variant="danger" isLoading={submitting} onClick={handleSubmit}>
            确认封禁
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p>封禁后该用户将无法登录与发帖，操作将写入审计日志。</p>
        <Select
          label="封禁原因"
          value={reason}
          options={REASON_OPTIONS}
          error={reasonError ?? undefined}
          onChange={(event) => {
            setReason(event.target.value);
            if (reasonError !== null) setReasonError(null);
          }}
        />
        <Textarea
          label="补充说明"
          value={note}
          placeholder="选填，补充封禁依据（最多 200 字）"
          maxLength={200}
          onChange={(event) => setNote(event.target.value)}
        />
        <p className="text-[13px] text-ink-muted">当前为无限期封禁，直至管理员手动解禁；限时封禁尚未开放。</p>
      </div>
    </Drawer>
  );
}
