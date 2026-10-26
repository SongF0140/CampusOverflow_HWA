"use client";

// 教师知识树工作台（KN-R01~03，K-05）：知识树（大纲分析建树/手动拓宽/删叶子）+
// 教学计划（手动与周报来源）+ 周报（差距一键加入教学计划/拓宽知识树）。
// AI 建议与周报差距均须教师确认才产生写入（E-17）。
import { useCallback, useMemo, useState } from "react";

import {
  addKnowledgeNodes,
  analyzeOutline,
  createTeachingPlanItem,
  deleteKnowledgeNode,
  deleteTeachingPlanItem,
  fetchKnowledgeTree,
  fetchTeachingPlan,
  fetchWeeklyReports,
  updateTeachingPlanItem,
} from "@/api/knowledge";
import {
  Button,
  ErrorState,
  LoadingSkeleton,
  Toast,
  type ToastTone,
} from "@/shared/components";
import { toErrorMessage, useAsyncData } from "@/shared/hooks/useAsyncData";
import type {
  KnowledgeTreeNode,
  KnowledgeTreeSuggestion,
  TeachingPlanItem,
  WeeklyReport,
} from "@/shared/types/knowledge";

const OUTLINE_MAX = 20000;

const TreeNode = ({ node, depth, onDelete }: {
  node: KnowledgeTreeNode;
  depth: number;
  onDelete?: (nodeId: number) => void;
}) => (
  <li className={depth > 0 ? "ml-5 border-l border-gray-200 pl-4" : ""}>
    <div className="flex items-center gap-2 py-1">
      <span className="text-sm text-gray-700">{node.name}</span>
      {node.position !== null && (
        <span className="text-xs text-gray-400">{node.position === "left" ? "左" : "右"}</span>
      )}
      {node.source === "report" && (
        <span className="rounded bg-amber-50 px-1 text-xs text-amber-700">周报拓宽</span>
      )}
      {onDelete !== undefined && node.children.length === 0 && (
        <button
          type="button"
          className="text-xs text-red-500 hover:underline"
          onClick={() => onDelete(node.id)}
        >
          删除
        </button>
      )}
    </div>
    {node.children.length > 0 && (
      <ul>
        {node.children.map((child) => (
          <TreeNode key={child.id} node={child} depth={depth + 1} onDelete={onDelete} />
        ))}
      </ul>
    )}
  </li>
);

export function KnowledgeView({ courseId }: { courseId: number }) {
  const [toast, setToast] = useState<{ tone: ToastTone; message: string } | null>(null);
  const showToast = useCallback((tone: ToastTone, message: string) => {
    setToast({ tone, message });
  }, []);

  const treeState = useAsyncData(() => fetchKnowledgeTree(courseId), [courseId]);
  const planState = useAsyncData(() => fetchTeachingPlan(courseId), [courseId]);
  const reportState = useAsyncData(() => fetchWeeklyReports(courseId), [courseId]);

  const [outline, setOutline] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [suggestions, setSuggestions] = useState<KnowledgeTreeSuggestion | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [newNodeName, setNewNodeName] = useState("");
  const [planTitle, setPlanTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const reports: WeeklyReport[] = reportState.data?.items ?? [];
  const latestReport = reports[0] ?? null;
  const planItems: TeachingPlanItem[] = planState.data?.items ?? [];
  const inorderNames = useMemo(
    () => (treeState.data?.inorder ?? []).map((node) => node.name),
    [treeState.data],
  );

  const reloadAll = useCallback(() => {
    treeState.reload();
    planState.reload();
    reportState.reload();
  }, [treeState, planState, reportState]);

  async function handleAnalyze() {
    const text = outline.trim();
    if (!text) {
      showToast("error", "请先粘贴教材大纲文本");
      return;
    }
    setAnalyzing(true);
    setSuggestions(null);
    try {
      const result = await analyzeOutline({ courseId, outlineText: text });
      setSuggestions(result);
      setSelected(Object.fromEntries(result.nodes.map((node) => [node.name, true])));
    } catch (caught) {
      showToast("error", toErrorMessage(caught));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleConfirmSuggestions() {
    const names = suggestions?.nodes.filter((node) => selected[node.name]).map((node) => node.name) ?? [];
    if (names.length === 0) {
      showToast("error", "请至少勾选一个知识点");
      return;
    }
    setBusy(true);
    try {
      const result = await addKnowledgeNodes(courseId, names);
      setSuggestions(null);
      setOutline("");
      treeState.reload();
      showToast("success", `已写入 ${result.data.nodes.length} 个知识点（累计）`);
    } catch (caught) {
      showToast("error", toErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleAddNode() {
    const name = newNodeName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await addKnowledgeNodes(courseId, [name]);
      setNewNodeName("");
      treeState.reload();
      showToast("success", "知识点已写入知识树");
    } catch (caught) {
      showToast("error", toErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteNode(nodeId: number) {
    setBusy(true);
    try {
      await deleteKnowledgeNode(courseId, nodeId);
      treeState.reload();
      showToast("success", "知识点已删除");
    } catch (caught) {
      showToast("error", toErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleAddPlan(title: string, reportId?: number) {
    setBusy(true);
    try {
      await createTeachingPlanItem(courseId, reportId === undefined
        ? { title }
        : { title, report_id: reportId });
      planState.reload();
      showToast("success", "已加入教学计划");
    } catch (caught) {
      showToast("error", toErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleTogglePlan(item: TeachingPlanItem) {
    setBusy(true);
    try {
      await updateTeachingPlanItem(courseId, item.id, {
        status: item.status === "done" ? "pending" : "done",
      });
      planState.reload();
    } catch (caught) {
      showToast("error", toErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePlan(item: TeachingPlanItem) {
    setBusy(true);
    try {
      await deleteTeachingPlanItem(courseId, item.id);
      planState.reload();
    } catch (caught) {
      showToast("error", toErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function handleWidenFromReport(topic: string) {
    setBusy(true);
    try {
      await addKnowledgeNodes(courseId, [topic]);
      treeState.reload();
      showToast("success", `知识点「${topic}」已写入知识树`);
    } catch (caught) {
      showToast("error", toErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (treeState.isLoading || planState.isLoading || reportState.isLoading) {
    return <LoadingSkeleton variant="detail" count={3} />;
  }
  if (treeState.error !== null) {
    return <ErrorState message={treeState.error} onRetry={reloadAll} />;
  }

  return (
    <div className="space-y-6">
      {toast !== null && (
        <Toast tone={toast.tone} message={toast.message} onClose={() => setToast(null)} />
      )}

      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-base font-semibold">课程知识树</h2>
        <p className="mb-3 text-xs text-gray-500">
          知识点按二叉搜索树组织（左小右大）；学生对本树可见。AI 建议与手动新增均需教师确认后写入。
        </p>
        {inorderNames.length > 0 && (
          <p className="mb-3 text-xs text-gray-500">
            知识点序（中序）：{inorderNames.join(" → ")}
          </p>
        )}
        <ul className="mb-4">
          {(treeState.data?.tree ?? []).map((root) => (
            <TreeNode key={root.id} node={root} depth={0} onDelete={handleDeleteNode} />
          ))}
        </ul>
        <div className="mb-4 flex gap-2">
          <input
            value={newNodeName}
            onChange={(event) => setNewNodeName(event.target.value)}
            placeholder="手动新增知识点名称"
            className="flex-1 rounded border px-3 py-2 text-sm"
            disabled={busy}
          />
          <Button variant="ghost" onClick={() => void handleAddNode()} disabled={busy}>
            新增
          </Button>
        </div>
        <div className="rounded border border-dashed p-3">
          <h3 className="mb-2 text-sm font-medium">从教材大纲建树（AI 分析）</h3>
          <textarea
            value={outline}
            onChange={(event) => setOutline(event.target.value.slice(0, OUTLINE_MAX))}
            placeholder="粘贴教材目录或章节大纲文本，AI 将提炼知识点建议"
            rows={4}
            className="mb-2 w-full rounded border px-3 py-2 text-sm"
            disabled={analyzing || busy}
          />
          <Button onClick={() => void handleAnalyze()} disabled={analyzing || busy}>
            {analyzing ? "分析中…" : "分析大纲"}
          </Button>
          {suggestions !== null && (
            <div className="mt-3">
              <p className="mb-2 text-xs text-gray-500">{suggestions.notes}</p>
              <ul className="mb-2 space-y-1">
                {suggestions.nodes.map((node) => (
                  <li key={node.name} className="flex items-start gap-2 text-sm">
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={selected[node.name] === true}
                        onChange={(event) => setSelected((previous) => ({
                          ...previous, [node.name]: event.target.checked,
                        }))}
                      />
                      <span>
                        <strong>{node.name}</strong>
                        <span className="ml-2 text-xs text-gray-500">{node.reason}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <Button
                variant="ghost"
                onClick={() => void handleConfirmSuggestions()}
                disabled={busy}
              >
                确认写入所选知识点
              </Button>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-base font-semibold">教学计划</h2>
        <div className="mb-3 flex gap-2">
          <input
            value={planTitle}
            onChange={(event) => setPlanTitle(event.target.value)}
            placeholder="新增教学计划条目（如：补充进程调度讲解）"
            className="flex-1 rounded border px-3 py-2 text-sm"
            disabled={busy}
          />
          <Button
            variant="ghost"
            onClick={() => {
              const title = planTitle.trim();
              if (title) void handleAddPlan(title);
              setPlanTitle("");
            }}
            disabled={busy}
          >
            加入
          </Button>
        </div>
        {planItems.length === 0 ? (
          <p className="text-sm text-gray-500">暂无条目。</p>
        ) : (
          <ul className="space-y-2">
            {planItems.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  onClick={() => void handleTogglePlan(item)}
                  className={item.status === "done" ? "text-gray-400 line-through" : "text-gray-800"}
                >
                  {item.title}
                </button>
                {item.source === "report" && (
                  <span className="rounded bg-sky-50 px-1 text-xs text-sky-700">周报</span>
                )}
                <button
                  type="button"
                  className="ml-auto text-xs text-red-500 hover:underline"
                  onClick={() => void handleDeletePlan(item)}
                >
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-base font-semibold">教学周报</h2>
        <p className="mb-3 text-xs text-gray-500">
          系统每周一自动对比近 7 天学生提问与知识树生成；仅您可见。
        </p>
        {latestReport === null ? (
          <p className="text-sm text-gray-500">暂无周报。</p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              {latestReport.week_start} ~ {latestReport.week_end} · 本周提问 {latestReport.question_count} 个
            </p>
            <div>
              <h3 className="mb-1 text-sm font-medium">未覆盖主题（建议拓宽）</h3>
              {latestReport.uncovered_topics.length === 0 ? (
                <p className="text-sm text-gray-500">本周提问均命中知识树。</p>
              ) : (
                <ul className="space-y-1">
                  {latestReport.uncovered_topics.map((topic) => (
                    <li key={topic.topic} className="flex flex-wrap items-center gap-2 text-sm">
                      <strong>{topic.topic}</strong>
                      <span className="text-xs text-gray-500">
                        {topic.question_count} 次提问 · {topic.suggestion}
                      </span>
                      <Button
                        variant="ghost"
                        onClick={() => void handleAddPlan(`拓宽知识点：${topic.topic}`, latestReport.id)}
                        disabled={busy}
                      >
                        加入教学计划
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => void handleWidenFromReport(topic.topic)}
                        disabled={busy || inorderNames.includes(topic.topic)}
                      >
                        {inorderNames.includes(topic.topic) ? "已拓宽" : "拓宽知识树"}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="mb-1 text-sm font-medium">提问热力</h3>
              {latestReport.heatmap.length === 0 ? (
                <p className="text-sm text-gray-500">本周无命中知识点的提问。</p>
              ) : (
                <ul className="space-y-1">
                  {latestReport.heatmap.map((entry) => (
                    <li key={entry.node_id} className="text-sm">
                      {entry.node_name}
                      <span className="ml-2 text-xs text-gray-500">{entry.question_count} 次</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="whitespace-pre-wrap rounded bg-gray-50 p-3 text-sm text-gray-700">
              {latestReport.content}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
