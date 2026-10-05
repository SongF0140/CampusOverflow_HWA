"use client";

import { useMemo, useState } from "react";

import { banUser, listUsers, unbanUser } from "@/api/users";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  LoadingSkeleton,
  Pagination,
  Select,
  Toast,
  type SelectOption,
  type ToastTone,
} from "@/shared/components";
import { toErrorMessage, useAsyncData } from "@/shared/hooks/useAsyncData";
import type { UserMe, UserRole, UserStatus } from "@/shared/types/auth";

import { AdminUsersTable, BanDrawer } from "./AdminUsersParts";

const PAGE_SIZE = 10;

type RoleFilter = "all" | UserRole;
type StatusFilter = "all" | UserStatus;

const ROLE_FILTER_OPTIONS: SelectOption[] = [
  { value: "all", label: "全部" },
  { value: "student", label: "学生" },
  { value: "teacher", label: "教师" },
  { value: "admin", label: "管理员" },
];

const STATUS_FILTER_OPTIONS: SelectOption[] = [
  { value: "all", label: "全部" },
  { value: "active", label: "正常" },
  { value: "banned", label: "已封禁" },
];

// TODO(接口差异)：AdminUserBanRequest 仅 reason 字段（≤200 字），
// 原因/说明/时长拼接进 reason 提交；后端补 duration 字段后改为独立传参
function buildBanReason(reason: string, note: string, duration: string): string {
  const text = `${reason}（${note ? `${note}；` : ""}时长：${duration}）`;
  return text.length > 200 ? text.slice(0, 200) : text;
}

// 用户管理（页面控件级设计说明 §4.2）：筛选头部 + 用户表 + 封禁 Drawer + 解禁 ConfirmDialog
// 登录与管理员守卫由 src/proxy.ts 服务端完成
export function AdminUsersView() {
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [banTarget, setBanTarget] = useState<UserMe | null>(null);
  const [unbanTarget, setUnbanTarget] = useState<UserMe | null>(null);
  const [isBanning, setIsBanning] = useState(false);
  const [toast, setToast] = useState<{ tone: ToastTone; message: string } | null>(null);

  const listState = useAsyncData(
    () => listUsers({ page, page_size: PAGE_SIZE }),
    [page, reloadToken],
  );
  // TODO(接口差异)：listUsers 仅支持 page/page_size，无 keyword/role/status 参数；
  // 筛选先对当前页数据本地过滤，后端补筛选参数后改为服务端过滤
  const rawItems = listState.data?.items;
  const filteredUsers = useMemo(() => {
    const normalizedKeyword = keyword.trim().toLowerCase();
    return (rawItems ?? []).filter((user) => {
      const hitKeyword =
        normalizedKeyword === "" ||
        user.username.toLowerCase().includes(normalizedKeyword) ||
        String(user.id).includes(normalizedKeyword);
      const hitRole = roleFilter === "all" || user.role === roleFilter;
      const hitStatus = statusFilter === "all" || user.status === statusFilter;
      return hitKeyword && hitRole && hitStatus;
    });
  }, [rawItems, keyword, roleFilter, statusFilter]);
  const users: UserMe[] = rawItems ?? [];
  const isReady = !listState.isLoading && listState.error === null;

  async function handleBanConfirm(reason: string, note: string, duration: string): Promise<void> {
    if (banTarget === null) return;
    setIsBanning(true);
    try {
      await banUser(banTarget.id, buildBanReason(reason, note, duration));
      setBanTarget(null);
      setToast({ tone: "success", message: "已封禁该用户" });
      setReloadToken((token) => token + 1);
    } catch (caught) {
      // 失败保留 Drawer 与已选内容，错误经 Toast 提示
      setToast({ tone: "error", message: toErrorMessage(caught) });
    } finally {
      setIsBanning(false);
    }
  }

  async function handleUnbanConfirm(): Promise<void> {
    if (unbanTarget === null) return;
    const target = unbanTarget;
    setUnbanTarget(null);
    try {
      await unbanUser(target.id);
      setToast({ tone: "success", message: "已解禁并通知用户" });
      setReloadToken((token) => token + 1);
    } catch (caught) {
      setToast({ tone: "error", message: toErrorMessage(caught) });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {toast ? (
        <Toast tone={toast.tone} message={toast.message} onClose={() => setToast(null)} />
      ) : null}

      <h2 className="text-[22px] font-semibold text-ink">用户管理</h2>

      <div className="flex flex-wrap items-end gap-3">
        <Input
          label="搜索用户"
          value={keyword}
          placeholder="昵称或用户 ID"
          className="w-[240px]"
          onChange={(event) => setKeyword(event.target.value)}
        />
        <div className="w-[140px]">
          <Select
            label="角色"
            value={roleFilter}
            options={ROLE_FILTER_OPTIONS}
            onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
          />
        </div>
        <div className="w-[140px]">
          <Select
            label="状态"
            value={statusFilter}
            options={STATUS_FILTER_OPTIONS}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          />
        </div>
      </div>

      {listState.isLoading ? <LoadingSkeleton variant="list" count={5} /> : null}

      {listState.error !== null ? (
        <ErrorState message={listState.error} onRetry={listState.reload} />
      ) : null}

      {isReady && users.length === 0 ? (
        <EmptyState title="暂无用户" description="平台上还没有注册用户。" />
      ) : null}

      {isReady && users.length > 0 && filteredUsers.length === 0 ? (
        <EmptyState
          title="未找到匹配用户"
          description="换个关键词，或放宽角色/状态筛选条件试试。"
        />
      ) : null}

      {isReady && filteredUsers.length > 0 ? (
        <AdminUsersTable
          users={filteredUsers}
          onBan={(user) => setBanTarget(user)}
          onUnban={(user) => setUnbanTarget(user)}
        />
      ) : null}

      {listState.data !== null && listState.data.total > PAGE_SIZE ? (
        <div className="flex justify-center">
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={listState.data.total}
            onChange={(next) => setPage(next)}
          />
        </div>
      ) : null}

      {banTarget !== null ? (
        <BanDrawer
          user={banTarget}
          submitting={isBanning}
          onSubmit={handleBanConfirm}
          onClose={() => setBanTarget(null)}
        />
      ) : null}

      <ConfirmDialog
        open={unbanTarget !== null}
        title={`确认解禁 · ${unbanTarget?.username ?? ""}`}
        description="解禁将立即生效并通知用户"
        danger
        onConfirm={() => {
          void handleUnbanConfirm();
        }}
        onCancel={() => setUnbanTarget(null)}
      />
    </div>
  );
}
