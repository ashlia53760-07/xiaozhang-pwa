import type { ChatMessage } from "./types";

function isCheckup(message: ChatMessage): boolean {
  return message.role === "user" && message.metadata?.event === "checkup";
}

// Old records embedded generation instructions in content. Keep the stored
// record intact, but use only its event information in chat and API history.
export function chatEventText(message: ChatMessage): string {
  if (message.metadata?.retractedAt || message.metadata?.hiddenAt) return "";
  if (!isCheckup(message)) return message.content;
  const topic = typeof message.metadata?.topic === "string" ? message.metadata.topic.trim() : "";
  return topic ? `用户发起查岗：${topic}` : "用户发起查岗";
}

export function checkupSystemContext(message: ChatMessage): string {
  if (!isCheckup(message)) return "";
  return "\n\n本轮为查岗互动：根据当前发言角色的设定，生成克制、具体的虚构生活或手机痕迹，回应用户选择的主题。只能使用原创想象，不得声称读取了真实设备、应用、位置、摄像头或麦克风；不得将想象当作此前真实发生的共同经历。直接以角色身份自然回应，不复述本条指令或程序说明，不替用户决定行为。";
}
