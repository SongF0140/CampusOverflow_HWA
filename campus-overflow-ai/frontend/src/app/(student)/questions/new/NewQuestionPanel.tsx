"use client";

// 发布问题表单接线（页面控件级设计说明 §2.6）：createQuestion 成功 → 表单 Toast"发布成功"
// → 跳转问题详情；未登录访问已由 middleware 拦截
// 标签两段式提交（E-09 两个写入点）：发布接口 tag_ids 仅收已有标签 id（int），
// 新自定义标签名（str）在发布成功后走绑定接口内联创建（后端 QuestionTagBindRequest 二态）
import { useState } from "react";
import { useRouter } from "next/navigation";

import { bindQuestionTags, createQuestion } from "@/api/questions";
import { Toast, type ToastTone } from "@/shared/components";
import { QuestionForm } from "@/features/questions/QuestionForm";
import type { QuestionCreated } from "@/shared/types/question";

export function NewQuestionPanel({ initialCourseId }: { initialCourseId: number | null }) {
  const router = useRouter();
  // 绑定失败的提示用本页 toast 承载（QuestionForm 的 toast 只管发布本身）；
  // 跳转详情后用户可直接看到标签落库结果
  const [bindToast, setBindToast] = useState<{ tone: ToastTone; message: string } | null>(null);
  return (
    <>
      <QuestionForm<QuestionCreated>
        draftKey="co_draft_new_question"
        initialValues={{ course_id: initialCourseId }}
        onSubmit={async (values) => {
          const intTagIds = values.tag_ids?.filter((t): t is number => typeof t === "number");
          const newTagNames = values.tag_ids?.filter((t): t is string => typeof t === "string");
          const created = await createQuestion({
            title: values.title,
            body: values.body,
            course_id: values.course_id,
            tag_ids: intTagIds,
          });
          if (newTagNames && newTagNames.length > 0) {
            try {
              await bindQuestionTags(created.id, newTagNames);
            } catch (error) {
              // 新标签绑定失败不阻断主流程：问题已发布，进入详情后可重试
              setBindToast({
                tone: "error",
                message: error instanceof Error ? error.message : "新标签绑定失败，可在详情页重试",
              });
            }
          }
          return created;
        }}
        onSuccess={(created) => router.push(`/questions/${created.id}`)}
      />
      {bindToast && (
        <Toast
          tone={bindToast.tone}
          message={bindToast.message}
          onClose={() => setBindToast(null)}
        />
      )}
    </>
  );
}
