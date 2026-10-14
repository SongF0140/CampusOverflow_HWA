// 环境变量卫生：空字符串一律等同"未设置"（T-18 预演线上故障 A-43）
//
// 背景：@ai-sdk/openai 的模块顶层执行 `createOpenAI()`，其内部 loadOptionalSetting 只把
// null/undefined 当未设置，传入 ""（compose 用 `${VAR:-}` 注入空值就会得到 ""）会在
// import 阶段直接抛 "baseURL must be a non-empty string"，进程退出码 1，容器健康检查失败。
//
// 本模块必须保持为 config.ts 的**第一个 import**：ESM 按 import 顺序求值，
// 先清场再加载 @ai-sdk/openai，否则清理代码永远晚于崩溃点执行。
const EMPTY_STRING_ENV_KEYS = ["OPENAI_BASE_URL", "OPENAI_API_KEY"] as const;

for (const key of EMPTY_STRING_ENV_KEYS) {
  if (process.env[key] === "") {
    delete process.env[key];
  }
}
