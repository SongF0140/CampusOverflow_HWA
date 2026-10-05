import Link from "next/link";

import { Card } from "@/shared/components";

// 操作结果页视图（补录页，页面控件级设计说明 §2.16）：
// 纯展示、无数据请求；结果上下文由跳转方通过 URL query 传入
// （参数约定见 src/app/(student)/action-result/page.tsx，供 G1 跳转规范引用）
export type ActionResultType = "success" | "error" | "info";

const TYPE_META: Record<
  ActionResultType,
  { icon: string; label: string; defaultTitle: string; iconClass: string }
> = {
  success: {
    icon: "✓",
    label: "成功",
    defaultTitle: "操作成功",
    iconClass: "bg-success-soft text-success-ink",
  },
  error: {
    icon: "✗",
    label: "失败",
    defaultTitle: "操作失败",
    iconClass: "bg-danger-soft text-danger-ink",
  },
  info: {
    icon: "ℹ",
    label: "提示",
    defaultTitle: "温馨提示",
    iconClass: "border border-line bg-panel text-ink-muted",
  },
};

export interface ActionResultData {
  type: ActionResultType;
  title: string;
  message: string | null;
  returnTo: string | null;
}

// 站内路径校验：仅接受以单个 / 开头的相对路径，防开放重定向
function toSafeReturnTo(value: string): string | null {
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

// 解析 URL query → 视图数据（page.tsx await searchParams 后调用；参数蛇形小写）：
// type 缺省或非法值回退 info；title 缺省按 type 取默认标题；message 可选；
// return_to 仅接受站内路径，外链直接忽略（不渲染返回按钮）
export function parseActionResultQuery(
  query: Record<string, string | string[] | undefined>,
): ActionResultData {
  const firstValue = (value: string | string[] | undefined): string | null => {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  };
  const rawType = firstValue(query.type);
  const type: ActionResultType = rawType === "success" || rawType === "error" ? rawType : "info";
  const meta = TYPE_META[type];
  const rawTitle = firstValue(query.title)?.trim() ?? "";
  const rawMessage = firstValue(query.message)?.trim() ?? "";
  const rawReturnTo = firstValue(query.return_to)?.trim() ?? "";
  return {
    type,
    title: rawTitle !== "" ? rawTitle : meta.defaultTitle,
    message: rawMessage !== "" ? rawMessage : null,
    returnTo: rawReturnTo !== "" ? toSafeReturnTo(rawReturnTo) : null,
  };
}

export function ActionResultView({ type, title, message, returnTo }: ActionResultData) {
  const meta = TYPE_META[type];
  return (
    <Card
      isPadded={false}
      className="mx-auto flex w-full max-w-[440px] flex-col items-center gap-5 px-6 py-10 text-center"
    >
      <span
        role="img"
        aria-label={meta.label}
        className={`flex h-16 w-16 items-center justify-center rounded-full text-[28px] font-semibold ${meta.iconClass}`}
      >
        {meta.icon}
      </span>
      <div className="flex flex-col gap-2">
        <h1 className="text-[18px] font-semibold text-ink">{title}</h1>
        {message ? <p className="text-[13px] leading-relaxed text-ink-muted">{message}</p> : null}
      </div>
      <div className="mt-1 flex flex-wrap justify-center gap-3">
        <Link
          href="/questions/new"
          className="co-focusable inline-flex h-10 items-center justify-center rounded-md bg-brand px-4 text-[14px] font-medium text-white transition-colors duration-150 ease-standard hover:bg-brand-strong"
        >
          继续提问
        </Link>
        {returnTo !== null ? (
          <Link
            href={returnTo}
            className="co-focusable inline-flex h-10 items-center justify-center rounded-md border border-line bg-canvas px-4 text-[14px] font-medium text-ink transition-colors duration-150 ease-standard hover:bg-panel"
          >
            返回来源页
          </Link>
        ) : null}
      </div>
    </Card>
  );
}
