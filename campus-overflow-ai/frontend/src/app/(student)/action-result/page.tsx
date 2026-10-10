import { ActionResultView, parseActionResultQuery } from "@/features/action-result/ActionResultView";

// 操作结果页（2026-10-06 补录，页面控件级设计说明 §2.16）：纯展示，无数据请求。
//
// URL query 参数约定（蛇形小写，供其他页面跳转时使用——G1 跳转规范以此为准）：
//   /action-result?type=success&title=问题已发布&message=…&return_to=/questions/1
//   type      结果类型：success 成功（绿 ✓）/ error 失败（红 ✗）/ info 提示（中性 ℹ）；
//             缺省或非法值按 info 渲染
//   title     结果标题（可选，缺省按 type 显示默认标题："操作成功"/"操作失败"/"温馨提示"）
//   message   摘要文案（可选）
//   return_to 返回来源页链接（可选，仅接受站内路径，外链会被忽略、不渲染返回按钮）
export default async function ActionResultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const result = parseActionResultQuery(query);

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-8">
      <ActionResultView {...result} />
    </main>
  );
}
