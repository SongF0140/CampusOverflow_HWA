# 项目上下文

## 项目概述
这是一个 Vibe Coding 实训项目，使用 Next.js 14 + TailwindCSS + TypeScript 构建。

## 技术栈版本
- Next.js: 14.x（App Router）
- React: 18.x
- TypeScript: 5.x
- TailwindCSS: 3.x
- Node.js: 20.x

## 重要约定
- 状态管理：简单状态用 useState，复杂状态用 useReducer，跨组件用 Context
- 数据获取：优先使用 Next.js Server Components + fetch
- 表单处理：使用 React Hook Form + Zod 验证
- UI 组件：优先使用 shadcn/ui
- 图标：使用 Lucide React

## API 约定
- RESTful 风格
- 统一响应格式：{ code: number, data: T, message: string }
- 错误码：200 成功，400 参数错误，401 未授权，500 服务器错误