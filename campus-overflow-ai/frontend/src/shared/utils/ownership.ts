/**
 * 判断当前登录用户是否是该内容的作者。
 *
 * TODO(等后端补 author_id / permissions)：详情与回答响应目前只返回作者用户名（author），
 * 没有 author_id，所以只能按用户名比对。username 在 users 表是唯一索引，比对是可靠的；
 * 后端补字段后只需改这一处。
 */
export function isAuthorOf(
  currentUsername: string | null | undefined,
  authorUsername: string,
): boolean {
  if (!currentUsername) return false;
  return currentUsername === authorUsername;
}
