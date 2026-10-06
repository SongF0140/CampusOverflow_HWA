export const metadata = { title: "我的课程 · CampusOverflow" };

// TODO(批次 6 切片 2)：本切片先占位，保证教师端导航不留死链；列表与新建/编辑课程在切片 2 落地
export default function TeacherCoursesPage() {
  return (
    <div className="rounded-lg border border-line bg-canvas p-6">
      <h1 className="text-[22px] font-semibold text-ink">我的课程</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
        课程列表、新建课程与编辑课程将在本批次的下一片实现。
      </p>
    </div>
  );
}
