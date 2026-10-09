import { Suspense } from "react";

import { SearchView } from "@/features/search/SearchView";
import { LoadingSkeleton } from "@/shared/components";

type SearchPageSearchParams = Record<string, string | string[] | undefined>;

// ?q= 为主（顶栏搜索框入口），?keyword= 为兼容别名；深链页码由 SearchView 的 URL 同步处理
function parseInitialKeyword(params: SearchPageSearchParams): string {
  const raw = params.q ?? params.keyword;
  return (typeof raw === "string" ? raw : "").trim();
}

// 搜索记录页（§2.17 补录 / spec「补录页面」）：Server 壳只解析参数，
// 搜索框/历史/结果交互在 SearchView（client）；useSearchParams 需要 Suspense 边界
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchPageSearchParams>;
}) {
  const keyword = parseInitialKeyword(await searchParams);

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-8">
      <Suspense
        fallback={
          <div className="flex flex-col gap-5">
            <div className="co-skeleton h-7 w-28 rounded-sm" />
            <div className="co-skeleton h-10 w-full max-w-[520px] rounded-md" />
            <LoadingSkeleton variant="list" count={5} />
          </div>
        }
      >
        <SearchView initialKeyword={keyword} />
      </Suspense>
    </main>
  );
}
