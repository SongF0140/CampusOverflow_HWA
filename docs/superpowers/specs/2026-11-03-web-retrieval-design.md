# 回答前网络检索与只读浏览器设计

用户已确认采用结构化搜索接口加Vercel agent-browser只读网页读取，并要求更新Agent依赖后推送。学生只允许白名单、角色和数据范围交集内的只读/网络检索增强；管理端治理继续单独审批和最多5轮。

新增`searchWeb`和`readWebPage`，实现既有公共AgentTool契约，由统一请求级工具工厂装配，学生/教师/管理员继承同一公共只读能力，再与角色规则和任务范围取交集；不在各端复制实现或把工具写死为学生/聊天专属。复用执行网关、累计预算与审计。搜索使用Tavily固定HTTPS API，密钥仅服务端环境读取，不传聊天历史、身份或服务凭据。未配置时不展示工具；提供方故障返回静态摘要，取消不降级。

网页工具仅读取本次请求搜索得到的URL。HTTPS优先，拒绝非HTTP(S)、URL凭据、内网/保留IP；DNS解析后固定连接地址，每次重定向重新验证，响应体及时间有界。先由受控HTTP客户端取得正文，使用不执行脚本/不加载资源的DOM解析器清理为文本，再经一次性loopback桥接以text/markdown交agent-browser read --require-md读取；严格核对accept-markdown路径，正文不会触发资源/链接遍历。CLI没有外部URL参数、业务凭据、个人配置、登录状态或任意命令能力。此模式不启动Chrome；动态网页自动化不在本批。实际验证发现该版本allowed-domains和代理设置会触发Chrome，故不使用这两种模式，不以取消URL边界解决。

外部结果标为不可信公开参考，不能作为站内事实或指令。网页来源进入本Run证据集，使用网络检索的回答必须引用真实返回的来源，未检索链接拒绝。请求间不共享搜索结果或浏览器会话。

依赖：Agent运行/CI升Node24以满足agent-browser0.41.1；配套升级Workflow5.3.0、serde5.0.0、world-postgres5.1.0、@ai-sdk/workflow2.0.93、ai7.0.161、provider4.0.35，保留治理边界。其他Agent依赖按兼容范围更新，TypeScript/ESLint/OTel等独立大版本不盲目跨越。

验证：先红灯工具/权限/SSRF/引用反例，再实现；运行真实Tavily协议替身、真实agent-browser本地桥接及生产构建产物冒烟。Linux Node24全量/类型/lint/build/Workflow/dev与PG运行兼容检查通过后推送；没有真实搜索密钥时不宣称线上搜索质量已验收。

官方依据：[agent-browser命令](https://agent-browser.dev/commands)、[安全与配置](https://agent-browser.dev/security)、[Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)。
