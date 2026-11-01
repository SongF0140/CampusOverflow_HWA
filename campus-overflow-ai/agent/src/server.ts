// HTTP启动与后台资源由Nitro管理；此模块只导出Hono路由。
import "dotenv/config";
import { createApp } from "./app.js";

export default createApp();
