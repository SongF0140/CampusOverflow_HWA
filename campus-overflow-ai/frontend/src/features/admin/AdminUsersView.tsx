"use client";

import { useState } from "react";

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
import type { UserRole, UserStatus } from "@/shared/types/auth";

import { AdminUsersTable, BanDrawer, type AdminUserRow } from "./AdminUsersParts";

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

function buildBanReason(reason: string, note: string): string {
  return note ? `${reason}（${note}）` : reason;
}

// 用户管理（页面控件级设计说明 §4.2）：筛选头部 + 用户表 + 封禁 Drawer + 解禁 ConfirmDialog
// 登录与管理员守卫由 src/proxy.ts 服务端完成
export function AdminUsersView() {
  const [page, setPage] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [banTarget, setBanTarget] = useState<AdminUserRow | null>(null);
  const [unbanTarget, setUnbanTarget] = useState<AdminUserRow | null>(null);
  const [isBanning, setIsBanning] = useState(false);
  const [toast, setToast] = useState<{ tone: ToastTone; message: string } | null>(null);

  const listState = useAsyncData(
    () => listUsers({ page, page_size: PAGE_SIZE,
      ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
      ...(roleFilter !== "all" ? { role: roleFilter } : {}),
      ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    }),
    [page, reloadToken, keyword, roleFilter, statusFilter],
  );
  const rawItems = listState.data?.items;
  const users: AdminUserRow[] = rawItems ?? [];
  const isReady = !listState.isLoading && listState.error === null;

  async function handleBanConfirm(reason: string, note: string): Promise<void> {
    if (banTarget === null) return;
    setIsBanning(true);
    try {
      await banUser(banTarget.id, buildBanReason(reason, note));
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
      setToast({ tone: "success", message: "已解禁该用户" });
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
          placeholder="按用户名搜索"
          maxLength={100}
          className="w-[240px]"
          onChange={(event) => { setKeyword(event.target.value); setPage(1); }}
        />
        <div className="w-[140px]">
          <Select
            label="角色"
            value={roleFilter}
            options={ROLE_FILTER_OPTIONS}
            onChange={(event) => { setRoleFilter(event.target.value as RoleFilter); setPage(1); }}
          />
        </div>
        <div className="w-[140px]">
          <Select
            label="状态"
            value={statusFilter}
            options={STATUS_FILTER_OPTIONS}
            onChange={(event) => { setStatusFilter(event.target.value as StatusFilter); setPage(1); }}
          />
        </div>
      </div>

      {listState.isLoading ? <LoadingSkeleton variant="list" count={5} /> : null}

      {listState.error !== null ? (
        <ErrorState message={listState.error} onRetry={listState.reload} />
      ) : null}

      {isReady && users.length === 0 && !keyword.trim() && roleFilter === "all" && statusFilter === "all" ? (
        <EmptyState title="暂无用户" description="平台上还没有注册用户。" />
      ) : null}

      {isReady && users.length === 0 && (keyword.trim() || roleFilter !== "all" || statusFilter !== "all") ? (
        <EmptyState
          title="未找到匹配用户"
          description="换个关键词，或放宽角色/状态筛选条件试试。"
        />
      ) : null}

      {isReady && users.length > 0 ? (
        <AdminUsersTable
          users={users}
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
        description="解禁将立即生效，用户可恢复登录和参与问答。"
        danger
        onConfirm={() => {
          void handleUnbanConfirm();
        }}
        onCancel={() => setUnbanTarget(null)}
      />
    </div>
  );
}
