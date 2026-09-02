# 编码风格规则

## 语言与框架
- 始终使用 TypeScript，开启 strict 模式
- React 组件使用函数式组件 + Hooks
- 样式使用 TailwindCSS，不使用行内样式或 CSS Module
- 使用 Next.js App Router（不使用 Pages Router）

## 命名规范
- 组件文件：PascalCase（如 `LoginForm.tsx`）
- 工具函数文件：camelCase（如 `formatDate.ts`）
- 常量文件：UPPER_SNAKE_CASE（如 `API_ENDPOINTS.ts`）
- React 组件：PascalCase（如 `UserProfile`）
- 函数和变量：camelCase（如 `getUserById`）
- 布尔变量：以 is/has/should 开头（如 `isLoading`）
- 事件处理器：以 handle 开头（如 `handleSubmit`）

## 代码风格
- 优先使用 const，避免 let，禁止 var
- 使用箭头函数，除非需要 this 绑定
- 优先使用函数式编程范式（map/filter/reduce）
- 使用解构赋值
- 每个函数不超过 30 行
- 使用 early return 减少嵌套
- 所有注释使用中文

## 类型定义
- 为所有函数参数和返回值添加类型注解
- 使用 interface 定义对象类型（不使用 type 别名定义对象）
- 使用 type 定义联合类型和工具类型
- 导出所有在其他文件中使用的类型

## 错误处理
- API 请求必须有 try-catch
- 用户可见的错误信息使用中文
- 控制台日志使用 English
- 使用自定义 Error 类，不使用裸字符串

## 目录结构
- components/ —— 可复用组件
- app/ —— 页面路由（Next.js App Router）
- lib/ —— 工具函数和业务逻辑
- types/ —— TypeScript 类型定义
- hooks/ —— 自定义 React Hooks
- constants/ —— 常量定义