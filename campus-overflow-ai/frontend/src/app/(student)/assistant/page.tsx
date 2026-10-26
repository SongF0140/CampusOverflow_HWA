import { AssistantChatView } from "@/features/agent-assist/AssistantChatView";

export const metadata = { title: "AI 课程助手 · CampusOverflow" };

// AI 课程助手（学生端）：登录守卫由 src/proxy.ts 白名单制覆盖（非公开页一律要求登录）
export default function AssistantPage() {
  return <AssistantChatView />;
}
