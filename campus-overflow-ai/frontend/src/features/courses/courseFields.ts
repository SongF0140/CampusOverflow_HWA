// 课程契约缺口字段的可选探测读取
// 后端列表响应暂无 semester/status、详情响应暂无 member_count（见 backend courses/schemas.py），
// 这里用 in 探测 + 类型收窄（禁 any）：后端补字段后 UI 自动生效，当前缺失时安全降级
export function readOptionalString(item: object, key: string): string | null {
  if (!(key in item)) return null;
  const value = (item as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function readOptionalCount(item: object, key: string): number | null {
  if (!(key in item)) return null;
  const value = (item as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// 后端课程暂无状态字段：现有课程一律按"进行中"展示；若后续返回 status="closed" 则显示"已结课"
export function courseStatusTone(course: object): "active" | "closed" {
  return readOptionalString(course, "status") === "closed" ? "closed" : "active";
}

// 学期选项从课程数据聚合去重（保序）；响应暂无 semester 字段时只剩"全部学期"
export function collectSemesters(courses: readonly object[]): string[] {
  const seen = new Set<string>();
  for (const course of courses) {
    const semester = readOptionalString(course, "semester");
    if (semester) seen.add(semester);
  }
  return [...seen];
}
