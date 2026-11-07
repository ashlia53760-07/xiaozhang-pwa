import { storage, type SceneFloorRow, type SceneFloorScope } from "./storage";
import { abstractValid, type SceneContextState } from "./scene-context-data";
import { FULL_SUMMARY_PROMPT, sceneScopeKey, summaryPlan, summarizeScene } from "./scene-context";
import { modelPreferences } from "./model-preferences";
import type { ApiProfile } from "./types";

type Mode = "life" | "date";
export class SceneContextUI {
  private dialog: HTMLDialogElement;
  private scope?: SceneFloorScope;
  private rows: SceneFloorRow[] = [];
  private state?: SceneContextState;
  private controller?: AbortController;
  private mode: Mode = "life";
  private revision = 0;
  constructor(private options: { scope(mode: Mode): SceneFloorScope | undefined; busy(): boolean; lock(value: boolean): void; profile(mode: Mode, scope: SceneFloorScope): Promise<ApiProfile>; changed(mode: Mode): void }) {
    this.dialog = document.createElement("dialog"); this.dialog.id = "scene-context-dialog"; this.dialog.className = "scene-context-dialog";
    this.dialog.innerHTML = `<header><h2>剧情总结与楼层发送</h2><button type="button" data-scene-context-close aria-label="关闭">×</button></header><div class="scene-context-body"><p id="scene-context-info"></p><p class="hint">原楼层仍完整可见。“不发送”只排除原楼层，不是删除。已生成的大总结单独保存，可继续提供压缩记忆，也可在下方停用。首次全文总结只读取未排除的原楼层；再次总结会合并启用的有效旧总结与新增记录。</p><section><h3>指定不发送的楼层</h3><div class="scene-context-range"><label>从第几层<input id="scene-context-from" type="number" min="1" step="1"></label><label>到第几层<input id="scene-context-to" type="number" min="1" step="1"></label></div><div class="scene-context-actions"><button type="button" id="scene-context-exclude">这段不发送</button><button type="button" id="scene-context-include">恢复这段发送</button><button type="button" id="scene-context-restore">恢复全部原楼层</button></div></section><section><h3>手动全文总结</h3><p id="scene-summary-plan" class="hint"></p><details><summary>查看内置总结指令</summary><pre id="scene-summary-prompt"></pre></details><div class="scene-context-actions"><button type="button" id="scene-summary-run">生成全文大总结</button><button type="button" id="scene-summary-stop" hidden>停止总结</button></div></section><p id="scene-context-status" role="status" aria-live="polite"></p><section id="scene-summary-list"></section></div>`;
    document.body.append(this.dialog);
    this.dialog.querySelector("#scene-summary-prompt")!.textContent = FULL_SUMMARY_PROMPT;
    this.dialog.querySelector("[data-scene-context-close]")!.addEventListener("click", () => { if (!this.controller) this.dialog.close(); });
    this.dialog.addEventListener("cancel", e => { if (this.controller) e.preventDefault(); });
    this.dialog.addEventListener("close", () => { this.scope = undefined; ++this.revision; });
    for (const [id, excluded] of [["exclude",true],["include",false]] as const) this.dialog.querySelector(`#scene-context-${id}`)!.addEventListener("click", () => { void this.range(excluded); });
    this.dialog.querySelector("#scene-context-restore")!.addEventListener("click", () => { void this.change(s => ({ ...s, excludedIds: [] })); });
    this.dialog.querySelector("#scene-summary-run")!.addEventListener("click", () => { void this.run(); });
    this.dialog.querySelector("#scene-summary-stop")!.addEventListener("click", () => this.controller?.abort());
    document.querySelectorAll<HTMLElement>("[data-scene-context-open]").forEach(button => button.addEventListener("click", () => { void this.open(button.dataset.sceneContextOpen as Mode); }));
  }
  private status(text: string) { this.dialog.querySelector("#scene-context-status")!.textContent = text; }
  async open(mode: Mode) {
    if (this.options.busy()) return;
    const scope = this.options.scope(mode); if (!scope) return;
    const revision = ++this.revision;
    try {
      const rows = await storage.sceneFloors(scope), state = await storage.sceneContext(sceneScopeKey(scope));
      if (revision !== this.revision) return;
      this.mode = mode; this.scope = scope; this.rows = rows; this.state = state; this.status("");
      (this.dialog.querySelector("#scene-context-from") as HTMLInputElement).value = rows.length ? "1" : "";
      (this.dialog.querySelector("#scene-context-to") as HTMLInputElement).value = rows.length ? String(rows.length) : "";
      this.render(); if (!this.dialog.open) this.dialog.showModal();
    } catch (e) { this.status(e instanceof Error ? e.message : "无法读取本场记录"); if (!this.dialog.open) this.dialog.showModal(); }
  }
  private render() {
    if (!this.state) return;
    const hidden = new Set(this.state.excludedIds), numbers = this.rows.flatMap((r,i) => hidden.has(r.id) ? [i+1] : []);
    this.dialog.querySelector("#scene-context-info")!.textContent = `本场 ${this.rows.length} 层；${numbers.length} 层原文不发送${numbers.length ? `：${ranges(numbers)}` : ""}。楼层编号以当前场景显示为准，设置绑定消息 ID，删除其他楼层不会误套。`;
    const plan = summaryPlan(this.rows, this.state);
    const remaining = plan.batches.length - (plan.draft?.processed ?? 0);
    this.dialog.querySelector("#scene-summary-plan")!.textContent = `第 ${plan.number} 次大总结；新增可整理 ${plan.pending.length} 层，${plan.previous ? "合并已有大总结" : "从可发送的原文开始"}。预计还需 ${remaining} 次模型请求，每次输出上限 ${Math.min(4096,modelPreferences().sceneOutput)} Token；用量与实际费用由接口决定。超长单层也分段完整处理。失败可继续已完成批次，生成成功后才启用新总结。`;
    (this.dialog.querySelector("#scene-summary-run") as HTMLButtonElement).textContent = plan.draft ? "继续全文大总结" : "生成全文大总结";
    const list = this.dialog.querySelector("#scene-summary-list")!; list.replaceChildren();
    const heading = document.createElement("h3"); heading.textContent = "本场已保存的大总结"; list.append(heading);
    for (const summary of [...this.state.abstracts].reverse()) {
      const details = document.createElement("details"), title = document.createElement("summary"), text = document.createElement("textarea"), label = document.createElement("label"), enabled = document.createElement("input"), save = document.createElement("button");
      const valid = abstractValid(summary,this.rows);
      title.textContent = `✦ 大总结 ${summary.number} ✦ · ${valid ? summary.enabled ? "用于后续剧情" : "已停用" : "来源已变化，暂不发送"}`;
      text.value = summary.text; text.rows = 12; text.maxLength = 20000; text.setAttribute("aria-label",`第 ${summary.number} 次大总结正文`);
      enabled.type = "checkbox"; enabled.checked = summary.enabled; enabled.disabled = !valid;
      label.append(enabled,document.createTextNode("将这份累计总结用于后续剧情（同场只使用最新启用的一份）"));
      enabled.addEventListener("change", () => { void this.change(s => ({ ...s, abstracts: s.abstracts.map(r => ({ ...r, enabled: r.id === summary.id ? enabled.checked : enabled.checked ? false : r.enabled })) })); });
      save.type="button";save.textContent="保存正文修改";
      save.addEventListener("click",()=>{ if (!text.value.trim()) {this.status("正文不能为空，原总结保留。");return;} void this.change(s=>({...s,abstracts:s.abstracts.map(r=>r.id===summary.id?{...r,text:text.value.trim()}:r)})); });
      details.append(title,label,text,save); list.append(details);
    }
    if (!this.state.abstracts.length) { const p=document.createElement("p");p.textContent="还没有手动大总结。打开此面板不会调用模型。";list.append(p); }
  }
  private async change(update: (s: SceneContextState) => SceneContextState) {
    if (!this.scope || !this.state || this.controller || this.options.busy()) return;
    const scope = this.scope;
    this.options.lock(true);
    try {
      const fresh = await storage.sceneFloors(scope);
      if (JSON.stringify(fresh.map(r=>[r.id,r.content]))!==JSON.stringify(this.rows.map(r=>[r.id,r.content]))) throw Error("楼层已在其他页面变化，请重新打开面板再选择范围。");
      this.state = await storage.saveSceneContext(sceneScopeKey(scope), update(this.state), this.state.revision);
      this.render(); this.options.changed(this.mode); this.status("已保存。原文仍可见，后续请求按这个范围发送。");
    } catch (e) { this.status(e instanceof Error ? e.message : "保存失败，原设置保留"); }
    finally { this.options.lock(false); }
  }
  private async range(excluded: boolean) {
    const from = Number((this.dialog.querySelector("#scene-context-from") as HTMLInputElement).value), to = Number((this.dialog.querySelector("#scene-context-to") as HTMLInputElement).value);
    if (!Number.isSafeInteger(from)||!Number.isSafeInteger(to)||from<1||to<from||to>this.rows.length) { this.status(`请输入 1～${this.rows.length} 内的起止楼层，结束层不能早于起始层。`); return; }
    const ids=this.rows.slice(from-1,to).map(r=>r.id);
    await this.change(s=>{ const set=new Set(s.excludedIds);for(const id of ids)excluded?set.add(id):set.delete(id);return {...s,excludedIds:[...set]}; });
  }
  private async run() {
    if (!this.scope || this.controller || this.options.busy()) return;
    const scope = this.scope, controller = new AbortController(); this.controller = controller; this.options.lock(true);
    this.dialog.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLTextAreaElement>("button,input,textarea").forEach(el=>el.disabled=true);
    const stop=this.dialog.querySelector<HTMLButtonElement>("#scene-summary-stop")!;stop.hidden=false;stop.disabled=false;
    const timeout=window.setTimeout(()=>controller.abort(),30*60_000);
    try {
      await summarizeScene(scope,await this.options.profile(this.mode,scope),controller.signal,text=>this.status(text));
    } catch(e) { this.status(controller.signal.aborted?"已停止总结。成功批次已保存，可以继续；旧总结仍保留。":e instanceof Error?e.message:"总结失败，原记录保留"); }
    finally {
      window.clearTimeout(timeout);this.controller=undefined;
      this.dialog.querySelectorAll<HTMLButtonElement|HTMLInputElement|HTMLTextAreaElement>("button,input,textarea").forEach(el=>el.disabled=false);stop.hidden=true;
      try {
        this.state=await storage.sceneContext(sceneScopeKey(scope));this.rows=await storage.sceneFloors(scope);
        this.render();this.options.changed(this.mode);
      } catch { this.status("暂时无法重新读取本场保存状态，请关闭后重开面板。已有记录未删除。"); }
      finally { this.options.lock(false); }
    }
  }
  async decorate(target: HTMLElement, scope: SceneFloorScope) {
    const key=sceneScopeKey(scope),state=await storage.sceneContext(key).catch(()=>undefined);
    if (!state) return; // A failed decorative read must not interrupt ordinary messages.
    if (this.options.scope(target.id.includes("date")?"date":"life") && sceneScopeKey(this.options.scope(target.id.includes("date")?"date":"life")!)!==key)return;
    const hidden=new Set(state.excludedIds);
    target.querySelectorAll<HTMLElement>("[data-message-id]").forEach(el=>{
      const excluded=hidden.has(el.dataset.messageId!);el.dataset.contextExcluded=String(excluded);
      el.querySelector(".scene-context-hidden-note")?.remove();
      if(excluded){const note=document.createElement("span");note.className="scene-context-hidden-note";note.textContent=" · 原文不发送给模型";el.querySelector(".scene-entry-count")?.append(note);}
    });
  }
}
function ranges(numbers:number[]):string {
  const result:string[]=[];let from=numbers[0],to=from;
  for(const n of numbers.slice(1)){if(n===to+1)to=n;else{result.push(from===to?String(from):`${from}～${to}`);from=to=n;}}
  if(from!==undefined)result.push(from===to?String(from):`${from}～${to}`);
  return result.join("、");
}
