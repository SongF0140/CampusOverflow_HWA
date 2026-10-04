/**
 * 前端常量：**唯一来源是后端源码**，改动必须同步后端对应文件。
 *
 * 为什么集中在这里：枚举与上限散落在各处手写字符串时，容易与后端取值不一致；
 * 集中成常量后，接口字段的类型直接由常量派生，取值不匹配会在类型检查阶段暴露。
 *
 * 来源文件：qa/domain.py、interaction/domain.py、identity/domain.py
 */

// ---------- 问题（qa/domain.py）----------
export const QUESTION_STATUS = {
  /** STATUS_PUBLISHED：正常展示 */
  published: "published",
  /** STATUS_RESOLVED：已被采纳解决 */
  resolved: "resolved",
} as const;

export type QuestionStatus = (typeof QUESTION_STATUS)[keyof typeof QUESTION_STATUS];

export const TITLE_MAX_LEN = 100; // TITLE_MAX_LEN
export const BODY_MAX_LEN = 20000; // BODY_MAX_LEN
export const COMMENT_MAX_LEN = 1000; // COMMENT_MAX_LEN
export const TAG_NAME_MAX_LEN = 50; // TAG_NAME_MAX_LEN
export const QUESTION_MAX_TAGS = 5; // QUESTION_MAX_TAGS
export const HOT_TAGS_LIMIT = 10; // HOT_TAGS_LIMIT

export const TAG_TYPE = { course: "course", tech: "tech", custom: "custom" } as const;
export type TagType = (typeof TAG_TYPE)[keyof typeof TAG_TYPE];

// ---------- 投票与声誉（interaction/domain.py）----------
export const VOTE_TARGET = { question: "question", answer: "answer" } as const;
export type VoteTargetType = (typeof VOTE_TARGET)[keyof typeof VOTE_TARGET];

export const VOTE_UP = 1; // VOTE_UP
export const VOTE_DOWN = -1; // VOTE_DOWN

export const REPUTATION = {
  accepted: 15, // REPUTATION_ACCEPTED
  answerUpvoted: 10, // REPUTATION_ANSWER_UPVOTED
  contentDownvoted: -2, // REPUTATION_CONTENT_DOWNVOTED
} as const;

export const RANK_PERIODS = ["week", "month", "all"] as const; // RANK_PERIOD_*
export type RankPeriod = (typeof RANK_PERIODS)[number];
export const RANK_LIMIT = 10; // RANK_LIMIT

// 通知类型：来源 interaction/service.py 中 notify(...) 的调用点（后端以字符串存储）
export const NOTIFICATION_TYPE = {
  answered: "answered", // 你的问题收到新回答
  commented: "commented", // 你的内容收到新评论
  accepted: "accepted", // 你的回答已被采纳
} as const;
export const NOTIFICATION_TYPE_LABEL: Record<string, string> = {
  [NOTIFICATION_TYPE.answered]: "新回答",
  [NOTIFICATION_TYPE.commented]: "新评论",
  [NOTIFICATION_TYPE.accepted]: "已采纳",
};

// ---------- 用户（identity/domain.py）----------
export const USER_ROLE = { student: "student", teacher: "teacher", admin: "admin" } as const;
export type UserRole = (typeof USER_ROLE)[keyof typeof USER_ROLE];

/** 角色中文标签（C-01：界面文案必须简体中文） */
export const USER_ROLE_LABEL: Record<UserRole, string> = {
  [USER_ROLE.student]: "学生",
  [USER_ROLE.teacher]: "教师",
  [USER_ROLE.admin]: "管理员",
};

export const USER_STATUS = { active: "active", banned: "banned" } as const;
export type UserStatus = (typeof USER_STATUS)[keyof typeof USER_STATUS];

// T-02a：研究生身份与助教认证（identity/domain.py）
export const IDENTITY_TYPE = {
  undergraduate: "undergraduate",
  postgraduate: "postgraduate",
} as const;
export type IdentityType = (typeof IDENTITY_TYPE)[keyof typeof IDENTITY_TYPE];

export const CERT_STATUS = {
  none: "none", // CERT_NONE
  pending: "pending", // CERT_PENDING
  approved: "approved", // CERT_APPROVED
  rejected: "rejected", // CERT_REJECTED
} as const;
export type CertStatus = (typeof CERT_STATUS)[keyof typeof CERT_STATUS];

// ---------- 接口查询参数枚举（后端 Query pattern）----------
export const QUESTION_SORTS = ["latest", "hot"] as const;
export type QuestionSort = (typeof QUESTION_SORTS)[number];

export const ANSWER_SORTS = ["latest", "votes", "accepted"] as const;
export type AnswerSort = (typeof ANSWER_SORTS)[number];
