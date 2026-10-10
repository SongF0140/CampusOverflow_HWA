// 投票的乐观更新预览：规则与后端 interaction/service.py vote() 完全一致（toggle 三分支）
// 取消：score - value；新增：score + value；反向：score + 2 * value
export function previewVote(
  score: number,
  myVote: number,
  value: 1 | -1,
): { score: number; myVote: number } {
  if (myVote === value) {
    return { score: score - value, myVote: 0 };
  }
  if (myVote === 0) {
    return { score: score + value, myVote: value };
  }
  return { score: score + value * 2, myVote: value };
}
