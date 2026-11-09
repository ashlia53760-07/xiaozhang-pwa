import { characters } from "./characters";
import { newId, storage } from "./storage";
import { scriptFromPerformance, validTheatreScript } from "./script-library";
import { assertUserPersona, scriptUserPersona } from "./user-persona-policy";
import type { DateSceneKind, TheatreScript } from "./types";

type Preset = { id: DateSceneKind; title: string; setting: string; atmosphere: string };
const esc = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const names = (ids: string[]) => ids.map(id => characters.find(row => row.id === id)?.name || id).join("、");

/** The folder edits instruction sheets; the existing date reader still owns every performance. */
export class ScriptLibraryUI {
  private loaded?: TheatreScript;
  private initialized = false;
  private defaultIds: string[] = ["zhang-qiling"];
  private saving = false;
  private revision = 0;
  private editor: HTMLElement;
  private list: HTMLElement;
  private runs: HTMLElement;
  private custom: HTMLTextAreaElement;
  constructor(private host: HTMLElement, private options: {
    busy(): boolean;
    status(text: string): void;
    preset(): Preset;
    selectPreset(id: DateSceneKind): void;
    background(): string | undefined;
    setBackground(id?: string): Promise<void>;
    openRun(id: string, resume: boolean): Promise<void>;
  }) {
    this.custom = host.querySelector("#date-custom-setting")!;
    host.querySelector(".date-intro")!.innerHTML = `<span class="scene-kicker">YOUR STORY COLLECTION</span><h3>一个剧本，可以有很多次相逢。</h3><p>自由选一位或多位角色。剧本保存指令，每次开演单独存档，记忆互不相通。</p>`;
    const editor = document.createElement("section"); editor.id = "script-editor"; editor.className = "script-editor";
    this.editor = editor;
    editor.innerHTML = `<div class="script-section-head"><h4 id="script-editor-heading">写一个新本</h4><small id="script-revision">尚未保存</small></div>
      <label>剧本名称<input id="script-title" maxlength="80" placeholder="给这次故事起个名字"></label>
      <fieldset class="script-cast"><legend>这次和谁演</legend><div class="script-mode"><label><input type="radio" name="script-mode" value="single" checked> 单人 · 你和一位角色</label><label><input type="radio" name="script-mode" value="multi"> 多人 · 你和多位角色</label></div><div id="script-characters">${characters.map(row => `<label><input type="checkbox" value="${esc(row.id)}"><span>${esc(row.name)}</span></label>`).join("")}</div><small id="script-cast-hint">选择一位角色；多人无需先建群。</small></fieldset>`;
    const presetDetails = document.createElement("details"); presetDetails.className = "script-presets";
    presetDetails.innerHTML = "<summary>从现有场景取一个开头</summary>";
    presetDetails.append(host.querySelector("#date-scene-grid")!); editor.append(presetDetails);
    editor.append(this.custom.closest("label")!);
    editor.insertAdjacentHTML("beforeend", `<label>氛围与文风<input id="script-atmosphere" maxlength="1000" placeholder="可留空，例如：生活感、克制、悬疑，按情节张弛"></label><details class="script-extra"><summary>本剧的称呼与人物安排（可选）</summary><label>本剧里怎么称呼你<input id="script-user-name" maxlength="60" placeholder="我"></label><label>本剧人物关系与创作要求<textarea id="script-arrangement" rows="3" maxlength="4000" placeholder="只在这个本里成立，不改日常人设与关系…"></textarea></label></details>`);
    editor.append(host.querySelector(".date-background-editor")!);
    editor.insertAdjacentHTML("beforeend", `<div class="script-buttons"><button type="button" id="script-save">保存剧本</button><button type="button" id="script-save-copy">另存一份</button></div><p class="hint">点开演也会先保存当前指令。修改、删除剧本不会改动已有演出。</p>`);
    editor.append(host.querySelector("#date-start")!);
    const shelf = document.createElement("section"); shelf.className = "script-shelf";
    shelf.innerHTML = `<div class="script-toolbar"><div class="script-tabs" role="tablist" aria-label="剧本夹内容"><button type="button" role="tab" aria-selected="true" id="script-tab-sheets">我的剧本</button><button type="button" role="tab" aria-selected="false" id="script-tab-runs">演出存档</button></div><button type="button" id="script-new">＋ 新建</button></div><div class="script-file-actions"><button type="button" id="script-export">导出剧本</button><button type="button" id="script-import">导入剧本</button><input type="file" accept="application/json,.json" id="script-import-file" hidden></div><div id="script-sheets" role="tabpanel" aria-labelledby="script-tab-sheets"></div><div id="script-runs" role="tabpanel" aria-labelledby="script-tab-runs" hidden></div>`;
    host.append(shelf, editor); this.list = shelf.querySelector("#script-sheets")!; this.runs = shelf.querySelector("#script-runs")!;
    const click = (id: string, run: () => Promise<void> | void) => host.querySelector(id)!.addEventListener("click", () => { void this.action(run); });
    click("#script-tab-sheets", () => this.tab(false)); click("#script-tab-runs", () => this.tab(true));
    click("#script-new", () => this.fresh());
    click("#script-save", async () => { await this.save(); this.options.status("剧本已保存。已有演出保持开场时的版本。"); });
    click("#script-save-copy", async () => { await this.save(true); this.options.status("已另存一份剧本。"); });
    click("#script-export", () => this.export()); click("#script-import", () => (host.querySelector("#script-import-file") as HTMLInputElement).click());
    host.querySelector<HTMLInputElement>("#script-import-file")!.addEventListener("change", event => {
      const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = "";
      if (file) void this.action(() => this.import(file));
    });
    host.querySelectorAll<HTMLInputElement>('[name="script-mode"]').forEach(input => input.addEventListener("change", () => this.enforceMode()));
    host.querySelectorAll<HTMLInputElement>("#script-characters input").forEach(input => input.addEventListener("change", () => {
      if (this.mode() === "single" && input.checked) host.querySelectorAll<HTMLInputElement>("#script-characters input").forEach(other => { if (other !== input) other.checked = false; });
      this.castHint();
    }));
    shelf.addEventListener("click", event => {
      const button = (event.target as Element).closest<HTMLButtonElement>("[data-script-load],[data-script-delete],[data-run-open],[data-run-resume],[data-run-template]");
      if (!button) return;
      void this.action(async () => {
        const scripts = await storage.theatreScripts(), id = button.dataset.scriptLoad || button.dataset.scriptDelete;
        if (id) {
          const script = scripts.find(row => row.id === id); if (!script) throw Error("这个剧本已移除，请刷新列表。");
          if (button.dataset.scriptDelete) {
            if (!window.confirm(`删除剧本「${script.title}」？已有演出存档会保留。`)) return;
            await storage.deleteTheatreScript(id, script.revision); if (this.loaded?.id === id) { this.loaded = undefined; this.label(); }
            await this.refresh(); this.options.status("剧本已删除，演出存档仍保留。");
          } else { if (!this.discard()) return; await this.fill(script); }
        } else if (button.dataset.runTemplate) {
          if (!this.discard()) return;
          const run = (await storage.dateSessions()).find(row => row.id === button.dataset.runTemplate); if (!run) throw Error("找不到这场演出。");
          await this.fill(scriptFromPerformance(run, await storage.groups())); this.options.status("已提取这一场使用的指令。可编辑后保存为新剧本。");
        } else await this.options.openRun(button.dataset.runOpen || button.dataset.runResume!, !!button.dataset.runResume);
      });
    });
    host.querySelector<HTMLButtonElement>("#date-start")!.textContent = "保存并开演 →";
  }
  private async action(run: () => Promise<void> | void) {
    if (this.saving || this.options.busy()) return;
    this.saving = true;
    const controls = [...this.host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLButtonElement>("input, textarea, button")];
    const disabled = controls.map(input => input.disabled); controls.forEach(input => { input.disabled = true; });
    try { await run(); } catch (error) { this.options.status(error instanceof Error ? error.message : "剧本操作失败，输入仍保留。"); }
    finally { controls.forEach((input, index) => { input.disabled = disabled[index]; }); this.saving = false; }
  }
  isBusy() { return this.saving; }
  private value(id: string) { return this.host.querySelector<HTMLInputElement | HTMLTextAreaElement>(id)!; }
  private mode(): "single" | "multi" { return this.host.querySelector<HTMLInputElement>('[name="script-mode"]:checked')!.value as "single" | "multi"; }
  private selected() { return [...this.host.querySelectorAll<HTMLInputElement>("#script-characters input:checked")].map(input => input.value); }
  private castHint() { this.host.querySelector("#script-cast-hint")!.textContent = `已选 ${this.selected().length} 位角色 · ${this.mode() === "single" ? "单人需选择一位" : "多人至少选择两位，无需先建群"}`; }
  private enforceMode() {
    if (this.mode() === "single") this.host.querySelectorAll<HTMLInputElement>("#script-characters input:checked").forEach((input, index) => { if (index) input.checked = false; });
    this.castHint();
  }
  private tab(runs: boolean) {
    this.list.hidden = runs; this.runs.hidden = !runs; this.editor.hidden = runs;
    this.host.querySelector("#script-tab-sheets")!.setAttribute("aria-selected", String(!runs)); this.host.querySelector("#script-tab-runs")!.setAttribute("aria-selected", String(runs));
  }
  private fingerprint() { return JSON.stringify([this.value("#script-title").value, this.custom.value, this.value("#script-atmosphere").value, this.value("#script-arrangement").value, this.value("#script-user-name").value, this.mode(), this.selected(), this.options.background()]); }
  private savedFingerprint = "";
  private discard() { return !this.savedFingerprint || this.savedFingerprint === this.fingerprint() || window.confirm("有尚未保存的剧本修改，仍要切换吗？"); }
  async open(defaultIds: string[]) {
    this.defaultIds = defaultIds;
    if (!this.initialized) { await this.fresh(defaultIds); this.initialized = true; }
    await this.refresh(); this.tab(false);
  }
  async fresh(defaultIds: string[] = this.defaultIds) {
    if (this.initialized && !this.discard()) return;
    const chosen = [...new Set(defaultIds)].filter(id => characters.some(row => row.id === id));
    const base = this.options.preset();
    await this.fill({ id: "", revision: 0, title: "", scene: base.id, setting: "", atmosphere: "", arrangement: "", userName: "", mode: chosen.length > 1 ? "multi" : "single", characterIds: chosen.length ? chosen : ["zhang-qiling"], createdAt: Date.now(), updatedAt: Date.now() });
  }
  private async fill(script: TheatreScript) {
    this.loaded = script.id ? structuredClone(script) : undefined;
    this.value("#script-title").value = script.title; this.custom.value = script.setting; this.value("#script-atmosphere").value = script.atmosphere;
    this.value("#script-arrangement").value = script.arrangement; this.value("#script-user-name").value = script.userName;
    this.host.querySelector<HTMLInputElement>(`[name="script-mode"][value="${script.mode}"]`)!.checked = true;
    this.host.querySelectorAll<HTMLInputElement>("#script-characters input").forEach(input => { input.checked = script.characterIds.includes(input.value); });
    this.options.selectPreset(script.scene); await this.options.setBackground(script.backgroundMediaId);
    this.tab(false); this.label(); this.castHint(); this.savedFingerprint = this.fingerprint();
    this.editor.scrollIntoView({ block: "start" });
  }
  choosePreset(base: Preset) { this.custom.value = base.setting; this.value("#script-title").value = base.title; this.value("#script-atmosphere").value = base.atmosphere; }
  private label() {
    this.host.querySelector("#script-editor-heading")!.textContent = this.loaded ? "编辑这个剧本" : "写一个新本";
    this.host.querySelector("#script-revision")!.textContent = this.loaded ? `已存 · 第 ${this.loaded.revision} 版` : "尚未保存";
  }
  async save(copy = false): Promise<TheatreScript> {
    const base = this.options.preset(), now = Date.now(), old = copy ? undefined : this.loaded;
    const setting = this.custom.value.trim() || base.setting;
    const draft = validTheatreScript({ id: old?.id || newId("script"), revision: old?.revision || 0,
      title: this.value("#script-title").value.trim() || (this.custom.value.trim() ? setting.split(/\r?\n/)[0].slice(0, 30) : base.title),
      scene: this.custom.value.trim() ? "custom" : base.id, setting, atmosphere: this.value("#script-atmosphere").value.trim() || base.atmosphere,
      arrangement: this.value("#script-arrangement").value.trim(), userName: this.value("#script-user-name").value.trim(), mode: this.mode(), characterIds: this.selected(),
      backgroundMediaId: this.options.background(), createdAt: old?.createdAt || now, updatedAt: now });
    if (!draft) throw Error(this.mode() === "multi" ? "多人剧本请至少选择两位角色，指令最多 6000 字。" : "单人剧本请选择一位角色，指令最多 6000 字。");
    assertUserPersona(scriptUserPersona(draft));
    const saved = await storage.saveTheatreScript(draft, old?.revision);
    this.loaded = saved; this.value("#script-title").value = saved.title; this.label(); this.savedFingerprint = this.fingerprint(); await this.refresh(); return structuredClone(saved);
  }
  async refresh() {
    const revision = ++this.revision;
    const [scripts, runs, groups] = await Promise.all([storage.theatreScripts(), storage.dateSessions(), storage.groups()]);
    if (revision !== this.revision) return;
    this.list.innerHTML = scripts.length ? scripts.map(script => `<article class="script-card"><div><strong>${esc(script.title)}</strong><small>${script.mode === "single" ? "单人" : "多人"} · ${esc(names(script.characterIds))} · 第 ${script.revision} 版</small><p>${esc(script.setting.slice(0, 110))}</p></div><div class="script-card-actions"><button type="button" data-script-load="${esc(script.id)}">选用 / 编辑</button><button type="button" data-script-delete="${esc(script.id)}">删除</button></div></article>`).join("") : `<p class="script-empty">这里收好你写过的开场与设定。选一个预设，或直接写下第一个本。</p>`;
    this.runs.innerHTML = runs.length ? runs.map(run => { const script = scriptFromPerformance(run, groups); return `<article class="script-card"><div><strong>${esc(run.title)}</strong><small>${run.active ? "进行中" : "已结束"} · ${esc(names(script.characterIds))} · ${run.messages.length} 层</small><small>${esc(new Date(run.updatedAt).toLocaleString())}${run.scriptSnapshot ? ` · 开演时第 ${run.scriptSnapshot.revision} 版` : " · 原有剧场"}</small><p>${esc(run.setting.slice(0, 90))}</p></div><div class="script-card-actions"><button type="button" data-run-resume="${esc(run.id)}">${run.active ? "继续演出" : "接着演"}</button><button type="button" data-run-open="${esc(run.id)}">查看记录</button><button type="button" data-run-template="${esc(run.id)}">指令收为剧本</button></div></article>`; }).join("") : `<p class="script-empty">开演后，正文和进度会保存在这里。返回剧本夹不会结束演出。</p>`;
  }
  private async export() {
    const scripts = await storage.theatreScripts(); if (!scripts.length) throw Error("还没有已保存的剧本。");
    const data = scripts.map(row => ({ ...row, backgroundMediaId: undefined }));
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: "xiaozhang-theatre-scripts", version: 1, scripts: data })], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "小手机-剧本夹.json"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 10000);
    this.options.status("已导出剧本指令，不含演出正文与背景图片；完整资料请用整机备份。");
  }
  private async import(file: File) {
    if (file.size > 5 * 1024 * 1024) throw Error("剧本文件不能超过 5 MB。");
    const payload = JSON.parse(await file.text());
    if (payload?.format !== "xiaozhang-theatre-scripts" || payload.version !== 1) throw Error("请选择本应用导出的剧本文件。");
    const count = await storage.importTheatreScripts(payload.scripts); await this.refresh(); this.tab(false);
    this.options.status(`已导入 ${count} 个剧本；同编号剧本保留本地版本。`);
  }
}
