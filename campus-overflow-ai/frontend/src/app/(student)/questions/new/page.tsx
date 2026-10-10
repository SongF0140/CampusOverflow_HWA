import { Card } from "@/shared/components";

import { NewQuestionPanel } from "./NewQuestionPanel";

// 右栏静态提示卡要点（§2.6："好问题更容易被解答"）
const TIPS = [
  "用描述性的问题作标题，一句话说清困惑",
  "补充课程与运行环境，方便对齐上下文",
  "写清复现步骤或粘贴报错信息",
  "添加相关标签，让擅长的人看到",
];

type QuestionNewSearchParams = Record<string, string | string[] | undefined>;

// ?course_id= 预填（课程详情页"我要提问"入口）；非法值忽略
function parseCourseId(params: QuestionNewSearchParams): number | null {
  const raw = params.course_id;
  const value = typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isInteger(value) && value > 0 ? value : null;
}

// 发布问题页（P-S06，页面控件级设计说明 §2.6）：Server 壳只解析预填参数，
// 表单交互在 NewQuestionPanel（client）；未登录由 middleware 跳登录
export default async function NewQuestionPage({
  searchParams,
}: {
  searchParams: Promise<QuestionNewSearchParams>;
}) {
  const params = await searchParams;
  const initialCourseId = parseCourseId(params);

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-8">
      <div className="flex flex-col gap-5">
        <h1 className="text-[22px] font-semibold text-ink">发布问题</h1>
        {/* 主区 8 列 + 右栏 4 列，窄屏右栏下沉（§0.1） */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-8">
            <Card isPadded={false} className="p-5">
              <NewQuestionPanel initialCourseId={initialCourseId} />
            </Card>
          </div>
          <aside className="min-w-0 lg:col-span-4">
            <div className="flex flex-col gap-4">
              {/* TODO(二期)：相似问题推荐（SSE），随 Agent 服务开放 */}
              <Card className="flex flex-col gap-3">
                <h2 className="text-[15px] font-semibold text-ink">好问题更容易被解答</h2>
                <ul className="flex flex-col gap-2">
                  {TIPS.map((tip) => (
                    <li
                      key={tip}
                      className="flex items-start gap-2 text-[13px] leading-relaxed text-ink-muted"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                      />
                      {tip}
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
