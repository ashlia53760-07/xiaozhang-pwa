import { defaultModelPreferences, modelPreferences, purposeLabels, saveModelPreferences } from "./model-preferences";
import { clearUsage, usageChangedEvent, usageRecords } from "./model-usage";

export class ModelCostUI {
  private host: HTMLElement;
  constructor(form: HTMLElement) {
    this.host = document.createElement("details"); this.host.id = "model-cost-controls"; this.host.className = "model-cost-controls";
    this.host.innerHTML = `<summary>按量计费 · 上下文与用量</summary><p class="hint">只调整实际请求，不折叠或删除聊天原文。人格、世界书和记忆归属保留；私聊仍自动总结，线下与剧场使用手动大总结。</p>
      <div class="model-cost-presets"><button type="button" data-model-preset="balanced">均衡设置</button><button type="button" data-model-preset="economy">省费设置</button></div>
      <div class="model-cost-fields"><label>私聊近期历史预算<input id="budget-private-history" type="number" min="800" max="12000" step="100"></label><label>线下／剧场历史预算<input id="budget-scene-history" type="number" min="800" max="24000" step="100"></label><label>私聊回复 Token 上限<input id="budget-private-output" type="number" min="256" max="8192" step="1"></label><label>线下／剧场回复 Token 上限<input id="budget-scene-output" type="number" min="512" max="16384" step="1"></label><label>自动总结最小间隔（分钟）<input id="budget-summary-minutes" type="number" min="10" max="120" step="1"></label></div>
      <p class="hint">历史预算是本地长度估算单位，不是服务商 Token 数；具体功能仍可使用更低的输出上限。达到历史阈值才会自动总结，调小历史预算可能减少可见于模型的细节。设置随下方“保存”生效。</p>
      <label class="check-row"><input id="budget-pause-background" type="checkbox"> 暂停自动朋友圈、自动配图、自动夜记和定时主动陪伴</label><p class="hint">主动发消息、手动重试和手动总结仍可使用；原来各项自动化的开关分别保留。</p>
      <label class="check-row"><input id="budget-request-usage" type="checkbox"> 兼容接口支持时，请求流式 usage 数据</label><p class="hint">默认不发送额外协议参数。仅在服务商支持 stream_options.include_usage 时开启；不支持的兼容服务可能拒绝请求。Gemini 原生会读取已有用量字段。</p>
      <h4>本机最近 100 次文字模型请求</h4><p class="hint">输入估算与服务商实际返回值分别显示；未返回不当作零。取消／失败可能仍产生费用。缓存 Token 是输入的子项，不重复计入。图片、音频和语音调用尚不在此表中，也不推算货币金额。</p><div id="model-usage-list" aria-live="polite"></div><button type="button" id="model-usage-clear">清空本机用量记录</button>`;
    const anchor = form.querySelector("#api-key")?.closest("label");
    if (anchor) anchor.after(this.host); else form.append(this.host);
    this.host.querySelectorAll<HTMLButtonElement>("[data-model-preset]").forEach(button => button.addEventListener("click", () => {
      this.fill(button.dataset.modelPreset === "economy" ? { ...defaultModelPreferences, privateHistory: 1800, sceneHistory: 2400, privateOutput: 1024, summaryMinutes: 30, pauseBackground: true } : defaultModelPreferences);
    }));
    this.host.querySelector("#model-usage-clear")!.addEventListener("click", () => clearUsage());
    window.addEventListener(usageChangedEvent, () => this.renderUsage());
    this.render();
  }
  private input(id: string) { return this.host.querySelector<HTMLInputElement>(`#budget-${id}`)!; }
  private fill(value: ReturnType<typeof modelPreferences>) {
    for (const [name, key] of [["private-history","privateHistory"],["scene-history","sceneHistory"],["private-output","privateOutput"],["scene-output","sceneOutput"],["summary-minutes","summaryMinutes"]] as const) this.input(name).value = String(value[key]);
    this.input("pause-background").checked = value.pauseBackground; this.input("request-usage").checked = value.requestUsage;
  }
  render() { this.fill(modelPreferences()); this.renderUsage(); }
  save() {
    saveModelPreferences({ privateHistory: Number(this.input("private-history").value), sceneHistory: Number(this.input("scene-history").value), privateOutput: Number(this.input("private-output").value), sceneOutput: Number(this.input("scene-output").value), summaryMinutes: Number(this.input("summary-minutes").value), pauseBackground: this.input("pause-background").checked, requestUsage: this.input("request-usage").checked });
  }
  private renderUsage() {
    const host = this.host.querySelector<HTMLElement>("#model-usage-list")!; host.replaceChildren();
    const rows = usageRecords().reverse();
    if (!rows.length) { host.textContent = "还没有记录到文字模型请求。"; return; }
    const totals = document.createElement("p");
    const measured = rows.filter(r => r.actual?.input !== undefined && r.actual?.output !== undefined);
    totals.textContent = `${rows.length} 次请求中，${measured.length} 次返回完整输入／输出用量；这些已返回值合计：输入 ${measured.reduce((sum,r) => sum + r.actual!.input!,0)}、输出 ${measured.reduce((sum,r) => sum + r.actual!.output!,0)} Token。其余请求用量未知，不代表免费。`;
    host.append(totals);
    for (const row of rows) {
      const details = document.createElement("details"), title = document.createElement("summary"), body = document.createElement("p");
      const status = { pending: "请求中／完成状态未知", success: "完成", failed: "失败", cancelled: "已取消" }[row.status] || "状态未知";
      title.textContent = `${new Date(row.at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})} · ${purposeLabels[row.purpose] || "文字调用"} · ${status}`;
      const b = row.breakdown, a = row.actual;
      const total = b.rules + b.history + b.summary + b.memories + b.current + (b.other ?? 0);
      const share = (n: number) => `${n}（${total ? Math.round(n / total * 100) : 0}%）`;
      body.textContent = `${row.model}\n本地输入估算：约 ${row.estimate} Token；实际发送历史 ${row.historyCount} 条；输出上限 ${row.outputLimit ?? "由接口决定"}。\n输入构成（本地长度单位／占比，非计费用量）：角色／场景设定 ${share(b.rules)}，历史 ${share(b.history)}，摘要 ${share(b.summary)}，记忆 ${share(b.memories)}，本轮 ${share(b.current)}，其他附加资料 ${share(b.other ?? 0)}。部分旧功能未提供分类时，系统内容计入设定／其他。总输入估算另含保守倍率及协议开销，不能与分类单位直接相加核账。\n服务商返回（Token）：输入 ${a?.input ?? "未返回"}，输出 ${a?.output ?? "未返回"}，输入中缓存 ${a?.cached ?? "未返回"}，思考 ${a?.reasoning ?? "未返回"}，总计 ${a?.total ?? "未返回"}。`;
      details.append(title, body); host.append(details);
    }
  }
}
