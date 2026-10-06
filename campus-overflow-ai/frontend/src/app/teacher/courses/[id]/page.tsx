export const metadata = { title: "课程管理 · CampusOverflow" };

// TODO(批次 6 切片 3)：本切片先占位，保证「点课程卡」不留死链；四个 Tab（问题/成员/标签/设置）在切片 3 落地
export default async function TeacherCourseManagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="rounded-lg border border-line bg-canvas p-6">
      <h1 className="text-[22px] font-semibold text-ink">课程管理</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
        课程 {id} 的问题 / 成员 / 标签 / 设置将在本批次的下一片实现。
      </p>
    </div>
  );
}
