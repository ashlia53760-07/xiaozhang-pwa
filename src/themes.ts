export const themes = [
  { id: "ink", name: "墨色", detail: "素纸墨痕", color: "#dededd" },
  { id: "warm", name: "暖白", detail: "蓝白手帐", color: "#f1f5f9" },
  { id: "night", name: "夜色", detail: "安静夜蓝", color: "#202631" },
  { id: "rococo", name: "洛可可", detail: "雾蓝缎带 · 奶白信笺", color: "#e5e8f0" },
  { id: "bronze", name: "青铜夜札", detail: "青铜山川 · 旧纸藏声", color: "#151f20" }
] as const;
export function selectedTheme(id: string) { return themes.find(theme => theme.id === id) ?? themes[1]; }
