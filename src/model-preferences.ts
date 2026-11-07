export interface ModelPreferences {
  privateHistory: number;
  sceneHistory: number;
  privateOutput: number;
  sceneOutput: number;
  summaryMinutes: number;
  pauseBackground: boolean;
  requestUsage: boolean;
}
const KEY = "xiaozhang-model-budgets";
export const defaultModelPreferences: ModelPreferences = {
  privateHistory: 3200, sceneHistory: 3200, privateOutput: 2048,
  sceneOutput: 3072, summaryMinutes: 10, pauseBackground: false, requestUsage: false
};
const bounds = { privateHistory: [800, 12000], sceneHistory: [800, 24000], privateOutput: [256, 8192], sceneOutput: [512, 16384], summaryMinutes: [10, 120] } as const;
export function validModelPreferences(value: unknown): ModelPreferences {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const result = { ...defaultModelPreferences };
  for (const key of Object.keys(bounds) as Array<keyof typeof bounds>) {
    const n = input[key], [min, max] = bounds[key];
    if (typeof n === "number" && Number.isFinite(n)) result[key] = Math.round(Math.max(min, Math.min(max, n)));
  }
  result.pauseBackground = input.pauseBackground === true;
  result.requestUsage = input.requestUsage === true;
  return result;
}
export function modelPreferences(): ModelPreferences {
  try { return validModelPreferences(JSON.parse(localStorage.getItem(KEY) || "null")); }
  catch { return { ...defaultModelPreferences }; }
}
export function saveModelPreferences(value: unknown): void {
  localStorage.setItem(KEY, JSON.stringify(validModelPreferences(value)));
}
export type RequestPurpose = "private" | "scene" | "auto-summary" | "manual-summary" | "background" | "other";
export const purposeLabels: Record<RequestPurpose, string> = {
  private: "私聊／通话", scene: "线下／剧场", "auto-summary": "自动总结", "manual-summary": "手动全文总结", background: "自动陪伴", other: "其他文字调用"
};
