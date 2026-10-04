import { describe, expect, it } from "vitest";

import { previewVote } from "./vote";

// 规则必须与后端 interaction/service.py vote() 的三个分支一致
describe("previewVote（与后端 toggle 语义一致）", () => {
  it("首次点赞：分数 +1", () => {
    expect(previewVote(3, 0, 1)).toEqual({ score: 4, myVote: 1 });
  });

  it("首次点踩：分数 -1", () => {
    expect(previewVote(3, 0, -1)).toEqual({ score: 2, myVote: -1 });
  });

  it("同向重复：取消，分数回退", () => {
    expect(previewVote(4, 1, 1)).toEqual({ score: 3, myVote: 0 });
    expect(previewVote(2, -1, -1)).toEqual({ score: 3, myVote: 0 });
  });

  it("反向切换：分数变化 2 倍", () => {
    expect(previewVote(4, 1, -1)).toEqual({ score: 2, myVote: -1 });
    expect(previewVote(2, -1, 1)).toEqual({ score: 4, myVote: 1 });
  });
});
