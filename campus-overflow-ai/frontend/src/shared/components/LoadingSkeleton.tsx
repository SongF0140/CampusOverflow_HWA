// 骨架屏：列表 / 详情 / 卡片三种形态（设计系统 §5：不用整页转圈）
type SkeletonVariant = "list" | "detail" | "card";

export function LoadingSkeleton({
  variant = "list",
  count = 3,
}: {
  variant?: SkeletonVariant;
  count?: number;
}) {
  const rows = Array.from({ length: count }, (_, i) => i);

  return (
    <div className="flex flex-col gap-3" role="status" aria-live="polite">
      <span className="sr-only">正在加载内容</span>
      {rows.map((i) => {
        if (variant === "detail") {
          return (
            <div key={i} className="flex flex-col gap-2">
              <div className="co-skeleton h-7 w-2/3 rounded-sm" />
              <div className="co-skeleton h-4 w-full rounded-sm" />
              <div className="co-skeleton h-4 w-5/6 rounded-sm" />
            </div>
          );
        }
        if (variant === "card") {
          return <div key={i} className="co-skeleton h-28 rounded-lg" />;
        }
        return (
          <div key={i} className="flex flex-col gap-2 rounded-lg border border-line bg-canvas p-4">
            <div className="co-skeleton h-5 w-1/2 rounded-sm" />
            <div className="co-skeleton h-4 w-4/5 rounded-sm" />
          </div>
        );
      })}
    </div>
  );
}
