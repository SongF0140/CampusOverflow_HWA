"use client";

// 学生端课程知识树侧栏区块（KN-R01，Q-09④：师生可见）：只读展示，无管理入口。
import { fetchKnowledgeTree } from "@/api/knowledge";
import { useAsyncData } from "@/shared/hooks/useAsyncData";
import type { KnowledgeTreeNode } from "@/shared/types/knowledge";

const TreeNode = ({ node, depth }: { node: KnowledgeTreeNode; depth: number }) => (
  <li className={depth > 0 ? "ml-3" : ""}>
    <span className="text-[13px] text-ink">{node.name}</span>
    {node.children.length > 0 && (
      <ul className="flex flex-col gap-1 border-l border-line-subtle pl-3">
        {node.children.map((child) => (
          <TreeNode key={child.id} node={child} depth={depth + 1} />
        ))}
      </ul>
    )}
  </li>
);

export function KnowledgeTreeAside({ courseId }: { courseId: number }) {
  const state = useAsyncData(() => fetchKnowledgeTree(courseId), [courseId]);
  // 知识树加载失败不影响课程详情主流程（X-02 精神）；无树静默隐藏区块
  if (state.isLoading || state.error !== null) return null;
  const tree = state.data?.tree ?? [];
  if (tree.length === 0) return null;
  return (
    <section className="rounded-lg border border-line-subtle bg-surface p-4">
      <h2 className="mb-2 text-sm font-semibold text-ink">课程知识树</h2>
      <ul className="flex flex-col gap-1">
        {tree.map((root) => (
          <TreeNode key={root.id} node={root} depth={0} />
        ))}
      </ul>
    </section>
  );
}
