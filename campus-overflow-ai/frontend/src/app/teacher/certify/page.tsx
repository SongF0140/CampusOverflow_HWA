export const metadata = { title: "优质内容认证 · CampusOverflow" };

// TODO(批次 6 切片 4)：本切片先占位，保证教师端导航不留死链；认证功能在切片 4 落地
export default function TeacherCertifyPage() {
  return (
    <div className="rounded-lg border border-line bg-canvas p-6">
      <h1 className="text-[22px] font-semibold text-ink">优质内容认证</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
        优质内容认证将在本批次的下一片实现：选择本人任教的课程 → 进入问题 → 在回答上认证。
      </p>
    </div>
  );
}
