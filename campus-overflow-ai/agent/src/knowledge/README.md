# 本地知识目录（AX-K）

本模块只读取受控 Markdown，不读取浏览器记忆/聊天，不直接连接业务数据库。服务接线默认关闭，启用时由外部提供 root、后端可信标签与当前授权课程。

卡片放在 root/cards/，正文放在同一 root 内其他目录。卡片恰好三个二级标题：

````markdown
## 领域名称
线性代数

## 元数据
```json
{"course_id":1,"year":2026,"tag_ids":[10],"source":{"kind":"textbook","id":"book-1"},"body":{"path":"books/book.md","bookmark":"cosine"}}
```

## 摘要
余弦相似度衡量向量方向关系。
````

正文用 `<a id="cosine"></a>` 定位起点，读取到下一个显式书签前；正文应包含 `[返回卡片](../cards/example.md)` 形式的反向链接。模型正文中的指令不能改变规则、账号或授权。

`createKnowledgeCatalog({root,trustedTags,onUpdate?,onError?})` 提供：

- `refresh()`：内容哈希扫描、增量重解析并原子发布，返回 version/added/updated/removed/parsed/errors。错误只给相对卡片 ID 与 invalid_source。
- `list(authorizedCourseIds)`：轻量领域索引，不包含摘要/正文；version 按可见卡片计算，避免泄露其他课程变更。
- `getCard(id,authorizedCourseIds)`：第二层摘要卡片，返回复制对象。
- `getBody(id,authorizedCourseIds,expectedVersion)`：第三层书签正文，重新核对卡片/正文哈希与可信词表；旧版本拒绝。expectedVersion 必须取相同授权范围 list 的版本。
- `start(intervalMs=60000)` / `stop()`：文件变化触发刷新＋定期全量核对，定时器/监听器不维持进程存活。目录未显式启用时不要调用 start。

trustedTags 为 `{id,course_id,source:"teacher"|"textbook",active}` 列表或异步提供器，必须来自后端验证，不能信任模型或本地卡片自行声称来源。授权课程列表也必须来自可信权限查询。调用方每次装配上下文前 refresh；撤权后必须重新取课程列表。管理员没有本模块内部全站绕过。

版本和目录是可重建内存快照，源 Markdown 是真值源。文件大小限制为卡片 64 KB、正文 2 MB，最多 10000 张卡片。全量核对仍读取文件计算哈希，“增量”指仅解析变化卡片，不声称零磁盘扫描或向量索引已实现。
