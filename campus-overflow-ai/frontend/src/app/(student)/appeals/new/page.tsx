import { AppealFormView } from "@/features/appeals/AppealFormView";

// 封禁申诉（页面控件级设计说明 §2.15）
// 登录守卫由 middleware 承担；封禁态判定与申诉表单在面板内做（后端仅认 Cookie 鉴权）
export default function AppealNewPage() {
  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-6 sm:px-8">
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-[20px] font-semibold text-ink">封禁申诉</h1>
          <p className="text-[13px] text-ink-muted">
            如你认为封禁存在误判，请提交申诉，管理员复核后会通过通知告知结果。
          </p>
        </header>
        <AppealFormView />
      </div>
    </main>
  );
}
