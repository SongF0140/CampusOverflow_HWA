import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "./client";
import * as answers from "./answers";
import * as comments from "./comments";
import * as courses from "./courses";
import * as notifications from "./notifications";
import * as questions from "./questions";
import * as reputation from "./reputation";
import * as search from "./search";
import * as tags from "./tags";
import * as users from "./users";
import * as votes from "./votes";

// 记录每次 fetch 的 URL 与 init，断言路径拼接、方法与蛇形参数
const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  calls.push({ url: String(input), init });
  return new Response(JSON.stringify({ code: 200, data: {}, message: "ok" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
});
const calls: Array<{ url: string; init?: RequestInit }> = [];

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  calls.length = 0;
  fetchMock.mockClear();
  vi.unstubAllGlobals();
});

// 单次响应替换：同样记录调用，供需要自定义回包的用例使用
function mockBodyOnce(body: unknown, status = 200) {
  fetchMock.mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  });
}

function lastCall(): { url: string; init?: RequestInit } {
  const call = calls[calls.length - 1];
  if (!call) throw new Error("fetch 未被调用");
  return call;
}

function dataOf(init?: RequestInit): unknown {
  if (!init?.body) return undefined;
  return JSON.parse(String(init.body)) as unknown;
}

describe("questions api", () => {
  it("fetchAnswers：默认第一页，指定旧回答所在页经 BFF 发送真实分页参数", async () => {
    await questions.fetchAnswers(4);
    expect(lastCall().url).toBe("/api/backend/api/questions/4/answers?sort=latest&page=1&page_size=20");
    await questions.fetchAnswers(4, "votes", 3, 20);
    expect(lastCall().url).toBe("/api/backend/api/questions/4/answers?sort=votes&page=3&page_size=20");
  });
  it("listQuestions：路径 + 蛇形查询参数，可选参数缺省不出现，并解析 Paged 信封", async () => {
    const paged = {
      code: 200,
      data: {
        items: [
          {
            id: 1,
            title: "红黑树怎么旋转",
            course_id: 3,
            author: "stu001",
            tags: [{ id: 2, name: "红黑树", type: "tech" }],
            status: "open",
            vote_score: 5,
            my_vote: 1,
            answer_count: 2,
            view_count: 30,
            has_accepted: true,
            created_at: "2026-09-20T10:00:00",
          },
        ],
        total: 1,
        page: 2,
        page_size: 20,
      },
      message: "ok",
    };
    fetchMock.mockClear();
    mockBodyOnce(paged);

    const result = await questions.listQuestions({
      page: 2,
      page_size: 20,
      course_id: 3,
      sort: "hot",
      unresolved: true,
      keyword: "红黑树",
      tag_id: undefined,
    });

    expect(lastCall().url).toBe(
      "/api/backend/api/questions?page=2&page_size=20&course_id=3&sort=hot&unresolved=true&keyword=%E7%BA%A2%E9%BB%91%E6%A0%91",
    );
    expect(result.total).toBe(1);
    expect(result.items[0]?.my_vote).toBe(1);
  });

  it("createQuestion：POST /questions，蛇形请求体", async () => {
    await questions.createQuestion({
      title: "进程与线程",
      body: "区别是什么？",
      course_id: 3,
      tag_ids: [1, "新标签"],
    });

    const call = lastCall();
    expect(call.url).toBe("/api/backend/api/questions");
    expect(call.init?.method).toBe("POST");
    expect(dataOf(call.init)).toEqual({
      title: "进程与线程",
      body: "区别是什么？",
      course_id: 3,
      tag_ids: [1, "新标签"],
    });
  });

  it("deleteQuestion：DELETE /questions/{id}", async () => {
    await questions.deleteQuestion(7);
    expect(lastCall().url).toBe("/api/backend/api/questions/7");
    expect(lastCall().init?.method).toBe("DELETE");
  });

  it("bindQuestionTags：POST /questions/{id}/tags，tag_ids 蛇形键", async () => {
    await questions.bindQuestionTags(7, [1, "作业三"]);
    expect(lastCall().url).toBe("/api/backend/api/questions/7/tags");
    expect(dataOf(lastCall().init)).toEqual({ tag_ids: [1, "作业三"] });
  });
});

describe("votes / answers api", () => {
  it("createVote：POST /votes，蛇形请求体并解析投票回包", async () => {
    mockBodyOnce({
      code: 200,
      data: { target_type: "question", target_id: 9, vote_score: 3, my_vote: 1 },
      message: "投票成功",
    });

    const result = await votes.createVote({ target_type: "question", target_id: 9, value: 1 });

    expect(lastCall().url).toBe("/api/backend/api/votes");
    expect(dataOf(lastCall().init)).toEqual({ target_type: "question", target_id: 9, value: 1 });
    expect(result).toEqual({ target_type: "question", target_id: 9, vote_score: 3, my_vote: 1 });
  });

  it("acceptAnswer：POST /answers/{id}/accept", async () => {
    await answers.acceptAnswer(12);
    expect(lastCall().url).toBe("/api/backend/api/answers/12/accept");
    expect(lastCall().init?.method).toBe("POST");
  });

  it("certifyAnswer / uncertifyAnswer：同一路径区分 POST 与 DELETE", async () => {
    await answers.certifyAnswer(12);
    expect(lastCall().init?.method).toBe("POST");
    await answers.uncertifyAnswer(12);
    expect(lastCall().init?.method).toBe("DELETE");
    expect(lastCall().url).toBe("/api/backend/api/answers/12/certify");
  });
});

describe("users / courses api", () => {
  it("公开用户内容和标签详情使用真实分页资源", async () => {
    await users.fetchUserQuestions(7, 2);
    expect(lastCall().url).toBe("/api/backend/api/users/7/questions?page=2&page_size=10");
    await users.fetchUserAnswers(7, 3);
    expect(lastCall().url).toBe("/api/backend/api/users/7/answers?page=3&page_size=10");
    await tags.fetchTag(99);
    expect(lastCall().url).toBe("/api/backend/api/tags/99");
  });
  it("mine由服务端筛选，负责课程按真实总数跨页读取", async () => {
    fetchMock.mockImplementationOnce(async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ code: 200, data: { items: [{ id: 1 }], total: 2 } }));
    });
    mockBodyOnce({ code: 200, data: { items: [{ id: 2 }], total: 2 } });
    const mine = await courses.fetchMyCourses();
    expect(mine.map((item) => item.id)).toEqual([1, 2]);
    expect(calls.map((call) => call.url)).toEqual([
      "/api/backend/api/courses?page=1&page_size=100&mine=true",
      "/api/backend/api/courses?page=2&page_size=100&mine=true",
    ]);
  });

  it("课程问题资源不可由query覆盖课程", async () => {
    await courses.listCourseQuestions(3, { course_id: 9, page: 2 });
    expect(lastCall().url).toBe("/api/backend/api/courses/3/questions?page=2");
  });
  it("users：me、公开信息、封禁的路径与请求体", async () => {
    await users.getMe();
    expect(lastCall().url).toBe("/api/backend/api/users/me");

    await users.getUser(5);
    expect(lastCall().url).toBe("/api/backend/api/users/5");

    await users.banUser(5, "恶意灌水");
    expect(dataOf(lastCall().init)).toEqual({ reason: "恶意灌水" });
    expect(lastCall().url).toBe("/api/backend/api/users/5/ban");

    await users.listUsers({ page: 2, page_size: 50 });
    expect(lastCall().url).toBe("/api/backend/api/users?page=2&page_size=50");
  });

  it("courses：加入与退出课程的路径与方法", async () => {
    await courses.joinCourse(3);
    expect(lastCall().url).toBe("/api/backend/api/courses/3/join");
    expect(lastCall().init?.method).toBe("POST");

    await courses.leaveCourse(3);
    expect(lastCall().url).toBe("/api/backend/api/courses/3/members/me");
    expect(lastCall().init?.method).toBe("DELETE");
  });

  it("助教认证：申请 / 列表 / 审核的路径、方法与参数", async () => {
    await users.applyAssistantCertification();
    expect(lastCall().url).toBe("/api/backend/api/users/me/assistant-certification/apply");
    expect(lastCall().init?.method).toBe("POST");

    await users.listAssistantCertifications({ status: "pending", page: 1, page_size: 20 });
    expect(lastCall().url).toBe(
      "/api/backend/api/users/assistant-certifications?status=pending&page=1&page_size=20",
    );

    await users.reviewAssistantCertification(8, "approve");
    expect(lastCall().url).toBe("/api/backend/api/users/8/assistant-certification/review");
    expect(dataOf(lastCall().init)).toEqual({ action: "approve" });
  });
});

describe("comments / notifications / tags / reputation / search api", () => {
  it("comments：问题与回答评论的发表与删除", async () => {
    await comments.createAnswerComment(12, { body: "赞", parent_id: 3 });
    expect(lastCall().url).toBe("/api/backend/api/answers/12/comments");
    expect(dataOf(lastCall().init)).toEqual({ body: "赞", parent_id: 3 });

    await comments.deleteComment(30);
    expect(lastCall().url).toBe("/api/backend/api/comments/30");
    expect(lastCall().init?.method).toBe("DELETE");
  });

  it("notifications：列表参数与已读回包", async () => {
    await notifications.listNotifications({ unread_only: true, page: 1 });
    expect(lastCall().url).toBe("/api/backend/api/notifications?unread_only=true&page=1");

    await notifications.markAllNotificationsRead();
    expect(lastCall().url).toBe("/api/backend/api/notifications/read-all");
    expect(lastCall().init?.method).toBe("POST");
  });

  it("tags：hot 布尔参数与 keyword 缺省", async () => {
    await tags.listTags({ hot: true });
    expect(lastCall().url).toBe("/api/backend/api/tags?hot=true");

    await tags.listTags();
    expect(lastCall().url).toBe("/api/backend/api/tags");
  });

  it("reputation：我的流水与榜单参数", async () => {
    await reputation.getMyReputation({ page: 2 });
    expect(lastCall().url).toBe("/api/backend/api/reputation/me?page=2");

    await reputation.getRank({ period: "week", course_id: 3 });
    expect(lastCall().url).toBe("/api/backend/api/reputation/rank?period=week&course_id=3");
  });

  it("search：q 必填并编码进查询串", async () => {
    await search.search({ q: "TCP 拥塞控制", sort: "hot" });
    // URLSearchParams 的空格序列化为 +
    expect(lastCall().url).toBe(
      "/api/backend/api/search?q=TCP+%E6%8B%A5%E5%A1%9E%E6%8E%A7%E5%88%B6&sort=hot",
    );
  });
});

describe("错误信封透传", () => {
  it("业务错误抛出 ApiError（403 带后端中文 message）", async () => {
    mockBodyOnce({ code: 403, data: null, message: "仅负责教师可认证" }, 403);

    const pending = answers.certifyAnswer(12);
    await expect(pending).rejects.toMatchObject({
      code: 403,
      message: "仅负责教师可认证",
    });
    await expect(pending).rejects.toBeInstanceOf(ApiError);
  });
});
